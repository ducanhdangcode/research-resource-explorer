import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildRequest,
  parseSnippets,
  geminiFindPassages,
  ENDPOINT,
} from "../src/gemini";
import { match } from "../src/matcher";

// Wrap a snippet array in the shape generateContent returns.
const reply = (snippets: unknown) => ({
  candidates: [
    { content: { parts: [{ text: JSON.stringify(snippets) }] } },
  ],
});

describe("gemini request building", () => {
  it("caps the source text and requests a JSON string array", () => {
    const req = buildRequest("x".repeat(500_000), "một nhận định dài");
    const prompt = req.contents[0]!.parts[0]!.text;
    // The source slice is bounded; the whole prompt must stay near the cap.
    expect(prompt.length).toBeLessThan(210_000);
    expect(req.generationConfig.responseMimeType).toBe("application/json");
    expect(req.generationConfig.responseSchema).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });
  it("prefers the verbatim quote over the claim when present", () => {
    const req = buildRequest("nguồn", "diễn giải", "trích nguyên văn");
    expect(req.contents[0]!.parts[0]!.text).toContain("trích nguyên văn");
  });
  it("includes conversation context when provided", () => {
    const withCtx = buildRequest("nguồn", "claim", "", "người dùng đang hỏi X");
    expect(withCtx.contents[0]!.parts[0]!.text).toContain("NGỮ CẢNH:");
    expect(withCtx.contents[0]!.parts[0]!.text).toContain("người dùng đang hỏi X");
    const withoutCtx = buildRequest("nguồn", "claim");
    // The section header (with colon) only appears when context is supplied.
    expect(withoutCtx.contents[0]!.parts[0]!.text).not.toContain("NGỮ CẢNH:");
  });
});

describe("gemini response parsing", () => {
  it("extracts, trims and de-dupes string snippets", () => {
    expect(parseSnippets(reply(["  a  ", "b", "a", "", 5]))).toEqual([
      "a",
      "b",
    ]);
  });
  it("returns [] for malformed or empty responses", () => {
    expect(parseSnippets(reply("not an array"))).toEqual([]);
    expect(parseSnippets({ candidates: [] })).toEqual([]);
    expect(parseSnippets({})).toEqual([]);
    expect(
      parseSnippets({ candidates: [{ content: { parts: [{ text: "{" }] } }] }),
    ).toEqual([]);
  });
});

describe("geminiFindPassages", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("POSTs to the endpoint with the key and returns parsed snippets", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => reply(["đoạn khớp"]) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await geminiFindPassages("nguồn", "nhận định", "", "KEY123");
    expect(out).toEqual(["đoạn khớp"]);
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url.startsWith(ENDPOINT)).toBe(true);
    expect(url).toContain("key=KEY123");
  });
  it("throws on a non-ok HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(
      geminiFindPassages("nguồn", "nhận định", "", "KEY"),
    ).rejects.toThrow("429");
  });
});

describe("verbatim snippets re-anchor via match()", () => {
  it("locates a returned passage as an exact/normalized candidate", () => {
    const text =
      "Phần mở đầu. Nghiên cứu ghi nhận mức giảm 30% sau 12 tháng. Phần kết.";
    const snippet = "Nghiên cứu ghi nhận mức giảm 30% sau 12 tháng.";
    const hit = match(text, "", snippet)[0]!;
    expect(hit.method).not.toBe("lexical");
    expect(text.slice(hit.start, hit.end)).toBe(snippet);
  });
});
