import { browser } from "wxt/browser";
import { match } from "../src/matcher";
import { indexDocument, locate, highlight } from "../src/dom";
export default defineUnlistedScript(() => {
  const scope = globalThis as typeof globalThis & {
    resourceExplorerLoaded?: boolean;
  };
  if (scope.resourceExplorerLoaded) return;
  scope.resourceExplorerLoaded = true;
  browser.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== browser.runtime.id ||
      !["MATCH", "HIGHLIGHT"].includes(message?.type)
    )
      return;
    void (async () => {
      if (document.contentType !== "text/html") {
        // PDFs render in Chrome's viewer with no readable DOM; hand them back
        // to the background so it can extract the text with pdf.js instead.
        if (message.type === "MATCH" && document.contentType === "application/pdf")
          return { pdf: true };
        throw new Error("Chỉ hỗ trợ HTML và PDF. Định dạng này chưa được hỗ trợ.");
      }
      const read = () =>
        indexDocument(
          document.querySelector('article,main,[role="main"]') || document.body,
        );
      if (message.type === "MATCH") {
        if (
          typeof message.claim !== "string" ||
          typeof message.quote !== "string"
        )
          throw new Error("Dữ liệu không hợp lệ.");
        CSS.highlights?.delete("resource-explorer");
        let index = read();
        let candidates = match(index.text, message.claim, message.quote);
        for (let retry = 0; !candidates.length && retry < 3; retry++) {
          await new Promise((resolve) => setTimeout(resolve, 700));
          index = read();
          candidates = match(index.text, message.claim, message.quote);
        }
        if (
          message.quote &&
          candidates.length === 1 &&
          candidates[0]!.method !== "lexical"
        )
          highlight(locate(index, candidates[0]!.start, candidates[0]!.end));
        return { candidates, actualUrl: location.href };
      }
      const index = read();
      const c = message.candidate;
      if (
        !c ||
        typeof c.text !== "string" ||
        index.text.slice(c.start, c.end) !== c.text
      )
        throw new Error("Nội dung đã thay đổi. Bấm tìm lại.");
      highlight(locate(index, c.start, c.end));
      return { ok: true };
    })()
      .then(respond)
      .catch((error) => respond({ error: error.message }));
    return true;
  });
});
