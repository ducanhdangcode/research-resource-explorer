export interface Citation {
  id: string;
  provider: string;
  url: string;
  title: string;
  claim: string;
  // Verbatim passage to locate, when the source exposes one (e.g. a Gemini
  // source link carries a #:~:text= fragment). Pre-fills the quote field.
  quote?: string;
  // Surrounding conversation (user turn + assistant answer) used as extra
  // context for the AI passage search. Absent for manual entries.
  context?: string;
}
export interface Candidate {
  text: string;
  start: number;
  end: number;
  method: "exact" | "normalized" | "lexical" | "semantic";
  score: number;
  // 1-based page number when the source is a PDF; used to jump via #page=N.
  page?: number;
}
export interface Task {
  id: string;
  url: string;
  claim: string;
  quote: string;
  context?: string;
  tabId?: number;
  createdAt: number;
  status: "opening" | "matching" | "completed" | "failed";
  candidates?: Candidate[];
  error?: string;
  actualUrl?: string;
}
export const taskKey = (id: string) => `task:${id}`;
export function webUrl(value: string) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Chỉ hỗ trợ URL HTTP/HTTPS không chứa thông tin đăng nhập.",
    );
  return url;
}
