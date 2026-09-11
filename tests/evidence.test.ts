import { describe, it, expect, beforeEach } from "vitest";
import { match, normalize } from "../src/matcher";
import { indexDocument, locate } from "../src/dom";
import { extractCitations } from "../src/adapters";
import { webUrl } from "../src/types";
beforeEach(() => {
  document.body.innerHTML = "";
});
describe("text anchoring", () => {
  it("maps a quote across nested inline nodes", () => {
    document.body.innerHTML =
      "<article><p>Nghiên cứu ghi nhận <strong>mức giảm 30%</strong> sau 12 tháng.</p></article>";
    const index = indexDocument(document.body);
    const c = match(index.text, "", "ghi nhận mức giảm 30% sau 12 tháng.")[0]!;
    expect(locate(index, c.start, c.end).toString()).toBe(
      "ghi nhận mức giảm 30% sau 12 tháng.",
    );
  });
  it("maps decomposed Unicode, quotes and whitespace to original offsets", () => {
    const text = "Intro: “NGHIÊN   CỨU” kết thúc. tail";
    const c = match(text, "", "“nghiên cứu” kết thúc.")[0]!;
    expect(c.method).toBe("normalized");
    expect(text.slice(c.start, c.end)).toBe("“NGHIÊN   CỨU” kết thúc.");
  });
  it("preserves UTF-16 offsets after emoji", () => {
    const text = "🌱 A sufficiently long quotation.";
    const c = match(text, "", "A sufficiently long quotation.")[0]!;
    expect(c.start).toBe(3);
    expect(c.end).toBe(text.length);
  });
  it("does not collapse paragraphs into a single word", () => {
    document.body.innerHTML = "<p>first paragraph</p><p>second paragraph</p>";
    expect(indexDocument(document.body).text).toBe(
      "first paragraph\nsecond paragraph",
    );
  });
  it("excludes navigation and hidden text", () => {
    document.body.innerHTML =
      "<nav>bad link</nav><p hidden>secret</p><p>readable content</p>";
    expect(indexDocument(document.body).text).toBe("readable content");
  });
  it("rejects a detached anchor", () => {
    document.body.innerHTML = "<p>A sufficiently long quotation.</p>";
    const index = indexDocument(document.body);
    document.body.innerHTML = "";
    expect(() => locate(index, 0, 20)).toThrow();
  });
});
describe("matching safety", () => {
  it("returns multiple identical occurrences as ambiguous candidates", () => {
    expect(
      match(
        "A sufficiently long quote.\nA sufficiently long quote.",
        "",
        "A sufficiently long quote.",
      ),
    ).toHaveLength(2);
  });
  it("returns no candidates for unrelated evidence", () => {
    expect(
      match(
        "Marine biology examines ocean ecosystems and coral reefs.",
        "The economic outlook predicts inflation increases",
      ),
    ).toEqual([]);
  });
  it("marks a paraphrase candidate lexical, including conflicting statements", () => {
    const candidates = match(
      "There is no evidence that aspirin reduces mortality by 30 percent in adults.",
      "Aspirin lowers adult mortality by 30 percent",
    );
    expect(candidates[0]?.method).toBe("lexical");
  });
  it("matches a short source passage against a long multi-sentence claim", () => {
    const claim =
      "The report covers many unrelated topics at length. Global coffee prices rose sharply in 2024 because of drought in Brazil. It also discusses shipping, tariffs, labour markets and a dozen other things in great detail.";
    const source =
      "Adverse weather drove the rally: coffee prices rose sharply in 2024 because of drought in Brazil, traders said.";
    const candidates = match(source, claim);
    expect(candidates[0]?.method).toBe("lexical");
  });
  it("rejects very short queries", () => {
    expect(match("research research research", "research")).toEqual([]);
  });
  it("normalizes grapheme expansions consistently", () => {
    expect(normalize("ﬁnd").value).toBe("find");
  });
});
describe("citation extraction", () => {
  it("extracts assistant links and ignores user messages/internal URLs", () => {
    document.body.innerHTML =
      '<div data-message-author-role="user"><a href="https://wrong.org">wrong</a></div><div data-message-author-role="assistant"><p>A research claim <a href="https://example.org/paper">[1]</a><a href="https://chatgpt.com/share/a">share</a></p></div>';
    const citations = extractCitations(document, "chatgpt.com");
    expect(citations).toHaveLength(1);
    expect(citations[0]?.claim).toContain("A research claim");
  });
  it("has adapters for Gemini and Claude", () => {
    document.body.innerHTML =
      '<model-response><p>Gemini claim <a href="https://example.org">source</a></p></model-response><div class="font-claude-response"><p>Claude claim <a href="https://example.org">source</a></p></div>';
    expect(extractCitations(document, "gemini.google.com")[0]?.provider).toBe(
      "Gemini",
    );
    expect(extractCitations(document, "claude.ai")[0]?.provider).toBe("Claude");
  });
  it("fails explicitly on unsupported providers", () => {
    expect(() => extractCitations(document, "example.org")).toThrow();
  });
  it("rejects executable URLs and embedded credentials", () => {
    expect(() => webUrl("javascript:alert(1)")).toThrow();
    expect(() => webUrl("https://u:p@example.org")).toThrow();
  });
});
