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

// Extract the assistant sentence carrying a Gemini inline source chip: prefer
// the paragraph the chip sits in, else the nearest preceding paragraph.
function extractClaimFromChip(chip: Element, answer: Element): string {
  const own = chip.closest("p,li,blockquote");
  if (own) {
    const text = own.textContent?.trim() ?? "";
    if (text.length > 30) return text.slice(0, 4000);
  }
  const host = chip.closest("p,li,blockquote,div") ?? chip;
  const paragraphs = [...answer.querySelectorAll("p,li,blockquote")];
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i]!;
    // Keep only paragraphs that come before the chip in document order.
    if (
      !(p.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING)
    )
      continue;
    const text = p.textContent?.trim() ?? "";
    if (text.length > 30) return text.slice(0, 4000);
  }
  return (answer.textContent ?? "").trim().slice(0, 4000);
}

// Parse the display names out of Gemini's source-chip aria-label.
// Label format: "Xem thông tin chi tiết từ nguồn trích dẫn: Name1 và Name2. Nhấn..."
// Names may contain spaces ("PYS Travel"); a name may also be a bare hostname.
function parseNamesFromAriaLabel(label: string): string[] {
  const colonIdx = label.indexOf(":");
  if (colonIdx === -1) return [];
  // The name list ends at ". " (period + space) — the ". Nhấn phím Enter…" tail.
  const rest = label.slice(colonIdx + 1);
  const sentenceEnd = rest.search(/\.\s/);
  const segment = sentenceEnd === -1 ? rest : rest.slice(0, sentenceEnd);
  const seen = new Set<string>();
  return segment
    .split(/\s+(?:và|and)\s+|,\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !seen.has(s) && seen.add(s));
}

const isDomainName = (s: string) =>
  !s.includes(" ") && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s);

// Google's own chrome (nav bar, avatar, static assets) also renders as <a href>;
// exclude every Google-owned host so only real citation sources survive.
function isGoogleOwned(host: string): boolean {
  return (
    host === "gemini.google.com" ||
    /(^|\.)google(\.[a-z]{2,3}){1,2}$/i.test(host) ||
    /(^|\.)(gstatic|googleusercontent|googleapis|ggpht)\.com$/i.test(host)
  );
}

// A Gemini source link carries the quoted passage as a text fragment
// (#:~:text=[prefix-,]start[,end][,-suffix]). Return the start text — the most
// reliable single probe for the matcher.
function parseTextFragment(url: URL): string {
  const m = url.hash.match(/:~:text=([^&]*)/);
  if (!m) return "";
  const texts = m[1]!
    .split(",")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .filter((s) => s && !s.endsWith("-") && !s.startsWith("-"));
  return (texts[0] ?? "").trim();
}

// Gemini hides real source URLs from the static DOM (only display names live in
// the chip aria-labels); a URL materialises only while the user has that
// source's card open. So we scan two sources: (1) real external anchors present
// anywhere in the document — opened source cards, which carry the full URL plus
// a #:~:text= passage — matched back to a chip for the claim; and (2) chips
// whose display name is itself a hostname, as a domain-only fallback.
function extractGeminiCitations(
  doc: Document,
  answers: Element[],
  userSelector: string,
): Citation[] {
  interface ChipInfo {
    name: string;
    claim: string;
    context: string;
  }
  const chipsByName = new Map<string, ChipInfo>();
  const domainChips: ChipInfo[] = [];
  for (const answer of answers) {
    let context: string | undefined;
    for (const chip of answer.querySelectorAll(
      ".source-inline-chip-container",
    )) {
      const btn = chip.querySelector("button");
      const names = parseNamesFromAriaLabel(btn?.getAttribute("aria-label") ?? "");
      if (!names.length) continue;
      if (context === undefined)
        context = extractContext(doc, answer, userSelector);
      const claim = extractClaimFromChip(chip, answer);
      for (const name of names) {
        const info = { name, claim, context };
        if (!chipsByName.has(name)) chipsByName.set(name, info);
        if (isDomainName(name)) domainChips.push(info);
      }
    }
  }

  const result: Citation[] = [];
  const seenUrl = new Set<string>();

  // (1) Real external anchors from opened source cards.
  for (const a of doc.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    let url: URL;
    try {
      url = webUrl(a.href);
    } catch {
      continue;
    }
    if (isGoogleOwned(url.hostname) || seenUrl.has(url.href)) continue;
    const anchorText = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    let matched: ChipInfo | undefined;
    for (const [name, info] of chipsByName) {
      if (name.length >= 3 && anchorText.startsWith(name)) {
        matched = info;
        break;
      }
    }
    const quote = parseTextFragment(url);
    const claim = matched?.claim || anchorText.slice(0, 4000) || quote;
    if (!claim && !quote) continue;
    seenUrl.add(url.href);
    result.push({
      id: `a:${result.length}`,
      provider: "Gemini",
      url: url.href,
      title: (matched?.name || url.hostname).slice(0, 120),
      claim,
      quote: quote || undefined,
      context: matched?.context,
    });
  }

  // (2) Domain-named chips with no opened card.
  for (const chip of domainChips) {
    const urlStr = `https://${chip.name}/`;
    let url: URL;
    try {
      url = webUrl(urlStr);
    } catch {
      continue;
    }
    if (isGoogleOwned(url.hostname) || seenUrl.has(url.href)) continue;
    seenUrl.add(url.href);
    result.push({
      id: `d:${result.length}`,
      provider: "Gemini",
      url: url.href,
      title: chip.name,
      claim: chip.claim,
      context: chip.context || undefined,
    });
  }

  return result;
}

// The conversation around a citation — the nearest preceding user question plus
// the assistant's full answer — gives the AI passage search far more to work
// with than the single sentence next to the link. Best-effort: if the user turn
// can't be located we still return the answer text.
function extractContext(
  doc: Document,
  answer: Element,
  userSelector: string,
): string {
  let question = "";
  if (userSelector) {
    const turns = [...doc.querySelectorAll(userSelector)].filter(
      (el) =>
        answer.compareDocumentPosition(el) &
        Node.DOCUMENT_POSITION_PRECEDING,
    );
    question = turns.at(-1)?.textContent?.trim() ?? "";
  }
  const reply = (answer.textContent ?? "").trim();
  return [
    question && `NGƯỜI DÙNG HỎI: ${question.slice(0, 2000)}`,
    reply && `TRỢ LÝ TRẢ LỜI: ${reply.slice(0, 6000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function extractCitations(doc: Document, hostname: string): Citation[] {
  const config = [
    {
      host: "chatgpt.com",
      name: "ChatGPT",
      selector: '[data-message-author-role="assistant"]',
      userSelector: '[data-message-author-role="user"]',
    },
    {
      host: "gemini.google.com",
      name: "Gemini",
      selector: "model-response",
      userSelector: "user-query",
    },
    {
      host: "claude.ai",
      name: "Claude",
      selector: "[data-is-streaming], .font-claude-response",
      userSelector: '[data-testid="user-message"], .font-user-message',
    },
    {
      host: "grok.com",
      name: "Grok",
      // Grok uses message-bubble for both roles; user turns are right-aligned.
      selector: ".message-bubble:not(.items-end .message-bubble)",
      userSelector: ".items-end .message-bubble",
    },
  ].find((c) => c.host === hostname);
  if (!config)
    throw new Error(
      "Mở ChatGPT, Gemini, Claude hoặc Grok rồi bấm icon extension. Hoặc nhập thủ công.",
    );
  const answers = [...doc.querySelectorAll(config.selector)];
  if (!answers.length)
    throw new Error(
      "Chưa nhận diện được câu trả lời. Mở danh sách nguồn rồi quét lại, hoặc nhập thủ công.",
    );
  if (hostname === "gemini.google.com")
    return extractGeminiCitations(doc, answers, config.userSelector)
      .slice(-100)
      .reverse();

  const result: Citation[] = [];
  for (const [answerIndex, answer] of answers.entries()) {
    let context: string | undefined;

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
      // Compute the conversation context lazily, once per answer that has a link.
      if (context === undefined)
        context = extractContext(doc, answer, config.userSelector);
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
        context: context || undefined,
      });
    }
  }
  return result.slice(-100).reverse();
}
