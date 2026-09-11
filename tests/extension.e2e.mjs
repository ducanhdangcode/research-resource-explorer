import { chromium } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
const folder = await mkdtemp(path.join(tmpdir(), "resource-explorer-test-"));
const extension = path.join(folder, "extension");
await cp(".output/chrome-mv3", extension, { recursive: true });
// Test-only host grant: production requests this permission from the user.
const manifest = JSON.parse(
  await readFile(path.join(extension, "manifest.json"), "utf8"),
);
manifest.host_permissions = ["http://127.0.0.1/*", "https://chatgpt.com/*"];
await writeFile(
  path.join(extension, "manifest.json"),
  JSON.stringify(manifest),
);
const quote = "Nghiên cứu ghi nhận mức giảm 30% sau 12 tháng.";
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><html lang="vi"><body><main><h1>Research fixture</h1><div style="height:1400px">Introduction</div><p>Nghiên cứu ghi nhận <strong>mức giảm 30%</strong> sau 12 tháng.</p><p>Results should be evaluated in their original context.</p></main></body></html>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/source`;
let context;
try {
  context = await chromium.launchPersistentContext(
    path.join(folder, "profile"),
    {
    channel: "chromium",
    executablePath: process.env.CHROME_PATH,
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.setViewportSize({ width: 400, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.locator("#url").fill(url);
  await page.locator("#quote").fill(quote);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/panel-explore.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Mở nguồn & tìm đoạn" }).click();
  await page
    .getByText("KHỚP VĂN BẢN", { exact: true })
    .waitFor({ timeout: 20000 });
  assert.equal(await page.locator(".evidence p").innerText(), quote);
  const source = context.pages().find((p) => p.url() === url);
  assert.ok(source);
  // Inspect isolated-world CSS highlight using scripting, the same world as the source script.
  const highlighted = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const source = tabs.find((t) => t.url?.startsWith("http://127.0.0.1"));
    return (
      await chrome.scripting.executeScript({
        target: { tabId: source.id },
        func: () => ({
          size: CSS.highlights.get("resource-explorer")?.size,
          y: scrollY,
        }),
      })
    )[0].result;
  });
  assert.equal(highlighted.size, 1);
  await source.waitForTimeout(600);
  assert.ok((await source.evaluate(() => scrollY)) > 500);
  await page.screenshot({ path: "artifacts/panel-result.png", fullPage: true });
  await source.screenshot({ path: "artifacts/source-highlight.png" });
  // No match must complete cleanly.
  await page.getByRole("button", { name: "Khám phá", exact: true }).click();
  await page
    .locator("#quote")
    .fill("Completely unrelated quotation about distant galaxies.");
  await page.getByRole("button", { name: "Mở nguồn & tìm đoạn" }).click();
  await page
    .getByText("Chưa tìm thấy đoạn phù hợp", { exact: false })
    .waitFor({ timeout: 20000 });
  // Existing session survives panel reload.
  await page.reload();
  await page.getByRole("button", { name: /Phiên nghiên cứu/ }).click();
  await page.locator(".task").nth(1).waitFor();
  assert.equal(await page.locator(".task").count(), 2);
  assert.deepEqual(errors, []);
  await context.route("https://chatgpt.com/test-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div data-message-author-role="assistant"><p>A citation claim for testing <a href="https://example.org/paper">Source</a></p></div>',
    }),
  );
  const ai = await context.newPage();
  await ai.goto("https://chatgpt.com/test-fixture");
  await ai.bringToFront();
  const scanned = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "SCAN" }),
  );
  assert.equal(
    scanned.citations?.[0]?.url,
    "https://example.org/paper",
    JSON.stringify(scanned),
  );
  console.log(
    "PASS: built extension opens source, highlights cross-node Vietnamese quote, scrolls, handles no match, restores session; no panel errors.",
  );
} catch (error) {
  for (const page of context?.pages() || []) {
    console.error('PAGE', page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 5000));
  }
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
}
