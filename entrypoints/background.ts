import { browser } from "wxt/browser";
import { taskKey, webUrl, type Candidate, type Task } from "../src/types";
import { match } from "../src/matcher";
import { pageAt } from "../src/pdf";
import { geminiFindPassages } from "../src/gemini";
export default defineBackground(() => {
  const geminiKey = import.meta.env.WXT_GEMINI_API_KEY as string | undefined;
  // Max candidates surfaced per task once local + AI results are merged.
  const MERGED_CAP = 8;
  // Whenever a key is configured, run the AI pass on every task and merge its
  // verbatim passages with the local ones, aiming for the widest useful set.
  // Each snippet is re-anchored via match() against the same text the offsets
  // were computed from; snippets Gemini altered (so they aren't verbatim) are
  // dropped to keep highlighting reliable. Best-effort: any failure leaves the
  // local candidates untouched — AI never fails the task.
  async function aiAugment(
    text: string,
    task: Task,
    local: Candidate[],
    starts?: number[],
  ): Promise<Candidate[]> {
    if (!geminiKey || !text.trim()) return local;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const snippets = await geminiFindPassages(
        text,
        task.claim,
        task.quote,
        geminiKey,
        task.context ?? "",
        controller.signal,
      );
      const semantic: Candidate[] = [];
      for (const snippet of snippets) {
        const hit = match(text, "", snippet)[0];
        if (!hit) continue;
        semantic.push({
          ...hit,
          method: "semantic",
          ...(starts ? { page: pageAt(starts, hit.start) } : {}),
        });
      }
      return [...semantic, ...local]
        .filter(
          (c, i, all) =>
            !all.slice(0, i).some((p) => c.start < p.end && c.end > p.start),
        )
        .slice(0, MERGED_CAP);
    } catch {
      return local; // network/quota/timeout — never fail the task over AI
    } finally {
      clearTimeout(timer);
    }
  }
  const looksLikePdf = (url: string) =>
    new URL(url).pathname.toLowerCase().endsWith(".pdf");
  // Reuse one offscreen document across tasks; the module flag resets whenever
  // the service worker restarts, and hasDocument() covers the survivor case.
  let offscreen: Promise<void> | undefined;
  function ensureOffscreen() {
    if (!offscreen)
      offscreen = (async () => {
        try {
          const api = browser.offscreen as typeof browser.offscreen & {
            hasDocument?: () => Promise<boolean>;
          };
          if (await api.hasDocument?.()) return;
          await browser.offscreen.createDocument({
            url: "offscreen.html",
            reasons: ["WORKERS"],
            justification: "Trích xuất văn bản từ tệp PDF để đối chiếu.",
          });
        } catch (error) {
          offscreen = undefined; // let the next task retry a fresh creation
          throw error;
        }
      })();
    return offscreen;
  }
  async function matchPdf(task: Task) {
    await ensureOffscreen();
    const result = (await browser.runtime.sendMessage({
      type: "PDF_EXTRACT",
      url: task.url,
    })) as { text: string; starts: number[] } | { error: string };
    if ("error" in result) throw new Error(result.error);
    const candidates = match(result.text, task.claim, task.quote).map(
      (c): Candidate => ({ ...c, page: pageAt(result.starts, c.start) }),
    );
    return {
      candidates: await aiAugment(result.text, task, candidates, result.starts),
      actualUrl: task.url,
    };
  }
  async function locate(task: Task) {
    let injected = false;
    try {
      await browser.scripting.executeScript({
        target: { tabId: task.tabId! },
        files: ["/source.js"],
      });
      injected = true;
      const result = await browser.tabs.sendMessage(task.tabId!, {
        type: "MATCH",
        claim: task.claim,
        quote: task.quote,
      });
      if (result?.error) throw new Error(result.error);
      if (result?.pdf) return await matchPdf(task);
      return {
        candidates: await aiAugment(
          (result.text as string) ?? "",
          task,
          result.candidates as Candidate[],
        ),
        actualUrl: result.actualUrl as string,
      };
    } catch (error) {
      // Chrome may refuse to inject into its PDF viewer at all; if the URL
      // looks like a PDF, extract it directly rather than surfacing the error.
      if (!injected && looksLikePdf(task.url)) return await matchPdf(task);
      throw error;
    }
  }
  const save = (task: Task) =>
    browser.storage.session.set({ [taskKey(task.id)]: task });
  const tasks = async () =>
    Object.entries(await browser.storage.session.get(null))
      .filter(([k]) => k.startsWith("task:"))
      .map(([, v]) => v as Task);
  const running = new Set<string>();
  async function run(task: Task) {
    if (!task.tabId || running.has(task.id)) return;
    running.add(task.id);
    try {
      const tab = await browser.tabs.get(task.tabId);
      if (tab.status !== "complete") return;
      task.status = "matching";
      await save(task);
      const result = await locate(task);
      task.candidates = result.candidates;
      task.actualUrl = result.actualUrl;
      task.status = "completed";
      task.error = undefined;
    } catch (error) {
      task.status = "failed";
      task.error = `${(error as Error).message} Nếu trang chuyển domain, mở tab nguồn và bấm icon extension, rồi thử lại.`;
    } finally {
      running.delete(task.id);
      await save(task);
    }
  }
  browser.action.onClicked.addListener((tab) => {
    if (tab.windowId) void browser.sidePanel.open({ windowId: tab.windowId });
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "complete")
      void tasks().then((items) =>
        Promise.all(
          items
            .filter(
              (t) =>
                t.tabId === tabId && ["opening", "matching"].includes(t.status),
            )
            .map(run),
        ),
      );
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void tasks().then((items) =>
      Promise.all(
        items
          .filter(
            (t) =>
              t.tabId === tabId && ["opening", "matching"].includes(t.status),
          )
          .map((t) =>
            save({ ...t, status: "failed", error: "Tab nguồn đã đóng." }),
          ),
      ),
    );
  });
  browser.alarms.onAlarm.addListener(() => {
    void tasks().then((items) =>
      Promise.all(
        items.map(async (task) => {
          if (Date.now() - task.createdAt > 3_600_000) {
            await browser.storage.session.remove(taskKey(task.id));
            return;
          }
          if (!["opening", "matching"].includes(task.status)) return;
          if (Date.now() - task.createdAt > 90_000)
            await save({
              ...task,
              status: "failed",
              error: "Trang phản hồi quá lâu. Hãy thử lại.",
            });
          else await run(task);
        }),
      ),
    );
  });
  browser.runtime.onInstalled.addListener(() => {
    void browser.alarms.create("recover", { periodInMinutes: 0.5 });
  });
  browser.runtime.onStartup.addListener(() => {
    void browser.alarms.create("recover", { periodInMinutes: 0.5 });
  });
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    // Only our panel may request privileged tab operations.
    if (
      sender.id !== browser.runtime.id ||
      !sender.url?.startsWith(browser.runtime.getURL("/sidepanel.html"))
    )
      return;
    void (async () => {
      if (message.type === "SCAN") {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) throw new Error("Không có tab đang mở.");
        const result = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["/ai.js"],
        });
        return result[0]?.result;
      }
      if (message.type === "START") {
        const url = webUrl(message.url);
        if (
          typeof message.claim !== "string" ||
          typeof message.quote !== "string" ||
          Math.max(message.claim.length, message.quote.length) > 10_000 ||
          (message.quote || message.claim).trim().length < 12
        )
          throw new Error("Nhập ít nhất 12 ký tự, tối đa 10.000 ký tự.");
        const task: Task = {
          id: crypto.randomUUID(),
          url: url.href,
          claim: message.claim,
          quote: message.quote,
          context:
            typeof message.context === "string"
              ? message.context.slice(0, 20_000)
              : undefined,
          createdAt: Date.now(),
          status: "opening",
        };
        await save(task);
        try {
          const tab = await browser.tabs.create({
            url: url.href,
            active: true,
          });
          task.tabId = tab.id;
          await save(task);
          void run(task);
        } catch (error) {
          await save({
            ...task,
            status: "failed",
            error: (error as Error).message,
          });
        }
        return { id: task.id };
      }
      if (message.type === "RETRY" || message.type === "HIGHLIGHT") {
        const task = (await browser.storage.session.get(taskKey(message.id)))[
          taskKey(message.id)
        ] as Task | undefined;
        if (!task?.tabId) throw new Error("Task không còn tồn tại.");
        if (message.type === "RETRY") {
          task.createdAt = Date.now();
          task.status = "opening";
          task.error = undefined;
          await save(task);
          void run(task);
          return { ok: true };
        }
        const candidate = task.candidates?.[message.index];
        if (!candidate) throw new Error("Đoạn không tồn tại.");
        await browser.tabs.update(task.tabId, { active: true });
        // PDFs have no highlightable DOM; jump the viewer to the page instead.
        if (candidate.page) {
          const url = new URL(task.url);
          url.hash = `page=${candidate.page}`;
          await browser.tabs.update(task.tabId, { url: url.href });
          return { ok: true };
        }
        return await browser.tabs.sendMessage(task.tabId, {
          type: "HIGHLIGHT",
          candidate,
        });
      }
      throw new Error("Yêu cầu không hợp lệ.");
    })()
      .then(respond)
      .catch((error) => respond({ error: error.message }));
    return true;
  });
});
