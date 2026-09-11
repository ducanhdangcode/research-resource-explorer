export interface Citation {
  id: string;
  provider: string;
  url: string;
  title: string;
  claim: string;
}
export interface Candidate {
  text: string;
  start: number;
  end: number;
  method: "exact" | "normalized" | "lexical";
  score: number;
}
export interface Task {
  id: string;
  url: string;
  claim: string;
  quote: string;
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
