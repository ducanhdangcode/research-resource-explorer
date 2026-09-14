import { beforeEach, describe, expect, it } from "vitest";
import { extractCitations } from "../src/adapters";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Grok citation extraction", () => {
  it("extracts sources and the nearest question, excluding user and navigation links", () => {
    document.body.innerHTML = `
      <nav><a href="https://unrelated.org">Navigation</a></nav>
      <div class="items-end"><div class="message-bubble"><div class="response-content-markdown">Old question</div></div></div>
      <div class="items-end"><div><div class="message-bubble"><div class="response-content-markdown">What does the research show? <a href="https://user.org">My link</a></div></div></div></div>
      <div class="items-start"><div class="message-bubble"><div class="response-content-markdown">
        <p>The research found a significant improvement after twelve months. <a href="https://example.org/paper">[1]</a><a href="https://example.org/paper">[1]</a></p>
        <a href="https://grok.com/share/123">Share</a>
        <a href="javascript:alert(1)">Invalid</a>
        <a href="https://user:pass@example.org/private">Credentials</a>
      </div></div></div>`;

    const citations = extractCitations(document, "grok.com");
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      provider: "Grok",
      url: "https://example.org/paper",
      title: "[1]",
    });
    expect(citations[0]?.claim).toContain("improvement after twelve months");
    expect(citations[0]?.context).toContain("What does the research show?");
    expect(citations[0]?.context).not.toContain("Old question");
  });

  it("preserves X posts as external sources and returns newest answers first", () => {
    document.body.innerHTML = `
      <div class="message-bubble"><p>The first answer cites a published research paper. <a href="https://example.org/paper">Paper</a></p></div>
      <div class="message-bubble"><p>The second answer cites a public announcement on X. <a href="https://x.com/research/status/123">Announcement</a></p></div>`;
    expect(extractCitations(document, "grok.com").map((c) => c.url)).toEqual([
      "https://x.com/research/status/123",
      "https://example.org/paper",
    ]);
  });

  it("reports missing answers instead of scanning user messages", () => {
    document.body.innerHTML =
      '<div class="items-end"><div class="message-bubble"><a href="https://user.org">Question</a></div></div>';
    expect(() => extractCitations(document, "grok.com")).toThrow(
      "Chưa nhận diện được câu trả lời",
    );
  });

  it("returns no citations for an answer without source links", () => {
    document.body.innerHTML =
      '<div class="message-bubble"><p>An answer without sources.</p></div>';
    expect(extractCitations(document, "grok.com")).toEqual([]);
  });
});
