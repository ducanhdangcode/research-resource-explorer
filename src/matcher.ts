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
// Break a long claim into sentence-sized probes. Matching the whole paragraph
// at once dilutes the score: the supporting passage in the source usually
// covers only one sentence, so requiring most of the paragraph's vocabulary in
// a single window almost never succeeds. Per-sentence probes keep the
// denominator small enough for a real match to clear the threshold.
function probes(query: string): Set<string>[] {
  const sentences = query
    .split(/(?<=[.!?。！？])\s+|[\n;]+/)
    .map(tokens)
    .filter((s) => s.size >= 3);
  if (sentences.length) return sentences;
  const whole = tokens(query);
  return whole.size >= 3 ? [whole] : [];
}
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
  const units = probes(query);
  if (!units.length) return [];
  const candidates: Candidate[] = [];
  for (const block of text.matchAll(/[^\n]+/g)) {
    const raw = block[0];
    if (raw.trim().length < 30) continue;
    for (let offset = 0; offset < raw.length; offset += 700) {
      const chunk = raw.slice(offset, offset + 1100);
      const available = tokens(chunk);
      // Score the window by its best-matching claim sentence, not the whole
      // paragraph, so a short supporting passage isn't penalised for the rest.
      let score = 0;
      let overlap = 0;
      for (const unit of units) {
        let hits = 0;
        for (const t of unit) if (available.has(t)) hits++;
        const unitScore = hits / unit.size;
        if (unitScore > score || (unitScore === score && hits > overlap)) {
          score = unitScore;
          overlap = hits;
        }
      }
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
