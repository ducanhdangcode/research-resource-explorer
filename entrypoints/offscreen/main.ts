import { browser } from "wxt/browser";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { assemblePdfText, type PdfExtract } from "../../src/pdf";

// The Chrome PDF viewer never exposes its text to a content script, so we fetch
// the bytes ourselves (the extension holds host permission for the origin) and
// pull the text out with pdf.js here, off the service worker's DOM-less thread.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

async function extract(url: string): Promise<PdfExtract> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Không tải được PDF (HTTP ${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (!/pdf/i.test(type) && !url.toLowerCase().split("?")[0]!.endsWith(".pdf"))
    throw new Error("Nguồn không phải PDF.");
  const data = new Uint8Array(await res.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  try {
    const doc = await task.promise;
    const pages: { str: string; hasEOL?: boolean }[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => {
          const it = item as { str?: string; hasEOL?: boolean };
          return { str: it.str ?? "", hasEOL: it.hasEOL };
        }),
      );
      page.cleanup();
    }
    return assemblePdfText(pages);
  } finally {
    await task.destroy();
  }
}

browser.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== browser.runtime.id || message?.type !== "PDF_EXTRACT")
    return;
  extract(message.url)
    .then(respond)
    .catch((error: Error) => respond({ error: error.message }));
  return true;
});
