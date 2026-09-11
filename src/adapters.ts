import type { Citation } from "./types";
import { webUrl } from "./types";

function extractClaim(link: HTMLAnchorElement, answer: Element): string {
  // Tier 1: immediate paragraph context, skip if it's just a citation marker
  const ctx = link.closest("p,li,blockquote");
  if (ctx) {
    const text = ctx.textContent?.trim() ?? "";
    if (text.length > 30 && !/^[\s\d\[\]().,↩↑•\-]+$/.test(text))
      return text.slice(0, 4000);
  }

  // Tier 2: scan preceding paragraphs in the answer for the nearest substantive text
  const paragraphs = [...answer.querySelectorAll("p,li,blockquote")];
  const linkPara = link.closest("p,li,blockquote,div");
  const idx = linkPara ? paragraphs.indexOf(linkPara) : -1;
  const from = idx === -1 ? paragraphs.length : idx;
  for (let i = from - 1; i >= 0; i--) {
    const text = paragraphs[i]?.textContent?.trim() ?? "";
    if (text.length > 30) return text.slice(0, 4000);
  }

  // Tier 3: full answer text
  return (answer.textContent ?? "").trim().slice(0, 4000);
}

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
      const claim = extractClaim(link, answer);
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
