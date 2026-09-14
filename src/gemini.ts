// Fallback semantic search: when local exact/lexical matching fails, ask Gemini
// to return the supporting passages *verbatim* so matcher.match() can re-anchor
// them to real offsets. Gemini never sees or returns character positions — it
// only quotes, and the caller locates the quote. Pure helpers (buildRequest,
// parseSnippets) are unit-tested; geminiFindPassages is the thin network wrapper.
const MODEL = "gemini-2.5-flash";
export const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
// Keep the request bounded. gemini-2.5-flash accepts far more, but page text is
// already capped at ~1M chars upstream and most sources are far shorter; this
// caps cost/latency and still covers the vast majority of articles.
const TEXT_CAP = 200_000;
export interface GeminiRequest {
  contents: { role: "user"; parts: { text: string }[] }[];
  generationConfig: {
    temperature: number;
    responseMimeType: "application/json";
    responseSchema: object;
  };
}
// Upper bound on how many passages we ask Gemini to return.
export const MAX_PASSAGES = 8;
// The claim/quote can be long; the surrounding conversation even longer. Cap
// each so the source text keeps the lion's share of the request budget.
const TARGET_CAP = 4_000;
const CONTEXT_CAP = 8_000;
export function buildRequest(
  text: string,
  claim: string,
  quote = "",
  context = "",
): GeminiRequest {
  const source = text.slice(0, TEXT_CAP);
  const target = (quote || claim).trim().slice(0, TARGET_CAP);
  const background = context.trim().slice(0, CONTEXT_CAP);
  const prompt = [
    "Bạn là công cụ đối chiếu trích dẫn. Dưới đây là NGUỒN (văn bản một trang), NHẬN ĐỊNH cần đối chiếu, và (nếu có) NGỮ CẢNH là đoạn hội thoại người dùng đang trao đổi với trợ lý AI.",
    "Nhiệm vụ: tìm CÀNG NHIỀU đoạn CÀNG TỐT trong NGUỒN có liên quan tới NHẬN ĐỊNH — bao gồm cả những đoạn chứng minh, phản bác, bổ sung số liệu, hoặc cung cấp bối cảnh liên quan. Dùng NGỮ CẢNH để hiểu rõ người dùng đang quan tâm điều gì và mở rộng phạm vi tìm kiếm.",
    "Trả về một mảng JSON gồm các đoạn được SAO CHÉP NGUYÊN VĂN từ NGUỒN (chính xác từng ký tự, giữ nguyên dấu câu và chữ hoa/thường). Mỗi đoạn một tới ba câu. Chỉ chép lại văn bản có thật trong NGUỒN, không diễn giải, không thêm bớt, không lặp lại đoạn đã có.",
    `Tối đa ${MAX_PASSAGES} đoạn, xếp theo mức độ liên quan giảm dần. Nếu không có đoạn nào liên quan, trả về [].`,
    "",
    `NHẬN ĐỊNH:\n${target}`,
    background ? `\nNGỮ CẢNH:\n${background}` : "",
    "",
    `NGUỒN:\n${source}`,
  ].join("\n");
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: { type: "array", items: { type: "string" } },
    },
  };
}
// Pull the model's JSON array of strings out of the generateContent response.
// Tolerates the response text arriving as a JSON string or already-parsed value,
// and never throws — a malformed reply just yields no snippets.
export function parseSnippets(response: unknown): string[] {
  const res = response as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = res?.candidates?.[0]?.content?.parts
    ?.map((p) => p?.text ?? "")
    .join("");
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
export async function geminiFindPassages(
  text: string,
  claim: string,
  quote: string,
  apiKey: string,
  context = "",
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildRequest(text, claim, quote, context)),
    signal,
  });
  if (!res.ok) throw new Error(`Gemini API lỗi (HTTP ${res.status}).`);
  return parseSnippets(await res.json());
}
