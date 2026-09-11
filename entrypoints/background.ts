import { browser } from "wxt/browser";
import { taskKey, webUrl, type Task } from "../src/types";
export default defineBackground(() => {
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
      await browser.scripting.executeScript({
        target: { tabId: task.tabId },
        files: ["/source.js"],
      });
      const result = await browser.tabs.sendMessage(task.tabId, {
        type: "MATCH",
        claim: task.claim,
        quote: task.quote,
      });
      if (result.error) throw new Error(result.error);
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
