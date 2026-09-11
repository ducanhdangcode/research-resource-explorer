import type { Citation } from "./types";
import { webUrl } from "./types";
export function extractCitations(doc: Document, hostname: string): Citation[] {
  const config = [
    {
      host: "chatgpt.com",
      name: "ChatGPT",
      selector: '[data-message-author-role="assistant"]',
    },
    { host: "gemini.google.com", name: "Gemini", selector: "model-response" },
    {
      host: "claude.ai",
      name: "Claude",
      selector: "[data-is-streaming], .font-claude-response",
    },
  ].find((c) => c.host === hostname);
  if (!config)
    throw new Error(
      "Mở ChatGPT, Gemini hoặc Claude rồi bấm icon extension. Hoặc nhập thủ công.",
    );
  const answers = [...doc.querySelectorAll(config.selector)];
  if (!answers.length)
    throw new Error(
      "Chưa nhận diện được câu trả lời. Mở danh sách nguồn rồi quét lại, hoặc nhập thủ công.",
    );
  const result: Citation[] = [];
  for (const [answerIndex, answer] of answers.entries())
    for (const link of answer.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      let url: URL;
      try {
        url = webUrl(link.href);
      } catch {
        continue;
      }
      if (url.hostname === hostname) continue;
      const context =
        link.closest("p,li,blockquote") || link.parentElement || answer;
      const claim = (context.textContent || "").trim().slice(0, 4000);
      if (result.some((c) => c.url === url.href && c.claim === claim)) continue;
      result.push({
        id: `${answerIndex}:${result.length}`,
        provider: config.name,
        url: url.href,
        title: (
          link.textContent ||
          link.getAttribute("aria-label") ||
          url.hostname
        ).trim(),
        claim,
      });
    }
  return result.slice(-100).reverse();
}
