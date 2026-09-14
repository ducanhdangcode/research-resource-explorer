import { describe, expect, it } from "vitest";
import { assemblePdfText, pageAt } from "../src/pdf";
import { match } from "../src/matcher";

describe("assemblePdfText", () => {
  it("joins runs with spaces and pages with newlines", () => {
    const { text, starts } = assemblePdfText([
      [{ str: "Hello" }, { str: "world", hasEOL: true }],
      [{ str: "second page" }],
    ]);
    expect(text).toBe("Hello world\nsecond page ");
    expect(starts).toEqual([0, 12]);
  });
  it("maps offsets to 1-based page numbers", () => {
    const { starts } = assemblePdfText([
      [{ str: "aaaa", hasEOL: true }],
      [{ str: "bbbb", hasEOL: true }],
      [{ str: "cccc", hasEOL: true }],
    ]);
    expect(pageAt(starts, 0)).toBe(1);
    expect(pageAt(starts, starts[1]!)).toBe(2);
    expect(pageAt(starts, starts[2]! + 2)).toBe(3);
  });
  it("lets match() find a claim and locate its page", () => {
    const { text, starts } = assemblePdfText([
      [{ str: "Introduction and unrelated preamble text here.", hasEOL: true }],
      [
        { str: "The study reported a 30% reduction" },
        { str: "in emissions after twelve months.", hasEOL: true },
      ],
    ]);
    const c = match(text, "", "a 30% reduction in emissions after twelve months")[0]!;
    expect(c).toBeTruthy();
    expect(pageAt(starts, c.start)).toBe(2);
  });
});
