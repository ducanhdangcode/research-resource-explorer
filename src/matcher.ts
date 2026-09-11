import type { Candidate } from "./types";
export function normalize(text: string) {
  let value = "";
  const offsets: number[] = [];
  const ends: number[] = [];
  for (const part of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(text)) {
    const transformed = part.segment
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    for (const char of transformed) {
      const c = /\s/.test(char) ? " " : char;
      if (c === " " && value.endsWith(" ")) {
        ends[ends.length - 1] = part.index + part.segment.length;
        continue;
      }
      value += c;
      for (let i = 0; i < c.length; i++) {
        offsets.push(part.index);
        ends.push(part.index + part.segment.length);
      }
    }
  }
  return { value, offsets, ends };
}
const tokens = (s: string) =>
  new Set(
    normalize(s)
      .value.match(/[\p{L}\p{N}]+/gu)
      ?.filter((t) => t.length > 2 || /\d/.test(t)) ?? [],
  );
export function match(text: string, claim: string, quote = ""): Candidate[] {
  const query = (quote || claim).trim();
  if (query.length < 12) return [];
  const norm = normalize(text);
  const needle = normalize(query).value.trim();
  const exact: Candidate[] = [];
  let from = 0;
  while (exact.length < 3) {
    const at = norm.value.indexOf(needle, from);
    if (at < 0) break;
    const start = norm.offsets[at]!,
      end = norm.ends[at + needle.length - 1]!;
    exact.push({
      text: text.slice(start, end),
      start,
      end,
      score: 1,
      method: text.slice(start, end) === query ? "exact" : "normalized",
    });
    from = at + needle.length;
  }
  if (exact.length) return exact;
  const wanted = tokens(query);
  if (wanted.size < 3) return [];
  const candidates: Candidate[] = [];
  for (const block of text.matchAll(/[^\n]+/g)) {
    const raw = block[0];
    if (raw.trim().length < 30) continue;
    for (let offset = 0; offset < raw.length; offset += 700) {
      const chunk = raw.slice(offset, offset + 1100);
      const available = tokens(chunk);
      const overlap = [...wanted].filter((t) => available.has(t)).length;
      const score = overlap / wanted.size;
      if (score >= 0.55 && overlap >= 3)
        candidates.push({
          text: chunk,
          start: block.index! + offset,
          end: block.index! + offset + chunk.length,
          score,
          method: "lexical",
        });
      if (offset + 1100 >= raw.length) break;
    }
  }
  return candidates
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length)
    .filter(
      (c, i, all) =>
        !all.slice(0, i).some((p) => c.start < p.end && c.end > p.start),
    )
    .slice(0, 3);
}
