import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { type Citation, type Task, webUrl } from "../../src/types";
import "./style.css";
async function send(message: object) {
  const result = await browser.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result;
}
function App() {
  const [citations, setCitations] = useState<Citation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [url, setUrl] = useState("");
  const [claim, setClaim] = useState("");
  const [quote, setQuote] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"explore" | "history">("explore");
  // Conversation context attached to the selected citation; passed to the AI
  // passage search. Cleared for manual entries.
  const [context, setContext] = useState("");
  useEffect(() => {
    const refresh = () => {
      void browser.storage.session.get(null).then((data) =>
        setTasks(
          Object.entries(data)
            .filter(([key]) => key.startsWith("task:"))
            .map(([, t]) => t as Task)
            .sort((a, b) => b.createdAt - a.createdAt),
        ),
      );
    };
    refresh();
    browser.storage.onChanged.addListener(refresh);
    return () => browser.storage.onChanged.removeListener(refresh);
  }, []);
  async function act(fn: () => Promise<void>) {
    setError("");
    setNote("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    // Call request directly from the click gesture, before asynchronous work.
    let parsed: URL;
    try {
      parsed = webUrl(url);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if ((quote || claim).trim().length < 12) {
      setError("Nhập nhận định hoặc trích đoạn dài ít nhất 12 ký tự.");
      return;
    }
    const permission = browser.permissions.request({
      origins: [`${parsed.protocol}//${parsed.hostname}/*`],
    });
    await act(async () => {
      if (!(await permission))
        throw new Error(
          "Chưa được cấp quyền đọc nguồn. Bạn có thể thử lại khi sẵn sàng.",
        );
      await send({ type: "START", url: parsed.href, claim, quote, context });
      setView("history");
    });
  }
  const latest = tasks[0];
  return (
    <main>
      <header>
        <div className="brand-icon">⌕</div>
        <div>
          <h1>Resource Explorer</h1>
          <p>FOLLOW THE SOURCE</p>
        </div>
        <span className="local">Local</span>
      </header>
      <nav aria-label="Chế độ">
        <button
          className={view === "explore" ? "selected" : ""}
          onClick={() => setView("explore")}
        >
          Khám phá
        </button>
        <button
          className={view === "history" ? "selected" : ""}
          onClick={() => setView("history")}
        >
          Phiên nghiên cứu <span>{tasks.length}</span>
        </button>
      </nav>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {note && (
        <div className="notice" role="status">
          {note}
        </div>
      )}
      {view === "explore" ? (
        <>
          <section className="intro">
            <span className="eyebrow">TỪ CÂU TRẢ LỜI ĐẾN BẰNG CHỨNG</span>
            <h2>
              Đọc tận nguồn.
              <br />
              <em>Hiểu rõ ngữ cảnh.</em>
            </h2>
            <p>Tìm đoạn văn phía sau citation, ngay trên trang gốc.</p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const res = await send({ type: "SCAN" });
                  const found: Citation[] = res?.citations || [];
                  // Merge, not replace: Gemini only exposes a source URL while
                  // its card is open, so users open a card, scan, open the next
                  // and scan again — each pass adds to the list.
                  setCitations((prev) => {
                    const byKey = new Map(
                      prev.map((c) => [`${c.url}\n${c.claim}`, c]),
                    );
                    for (const c of found) byKey.set(`${c.url}\n${c.claim}`, c);
                    return [...byKey.values()];
                  });
                  if (!found.length)
                    setNote(
                      "Chưa thấy link nguồn. Trên Gemini, mở (bấm) thẻ nguồn để hiện link rồi quét lại — mỗi lần quét sẽ thêm vào danh sách. Hoặc nhập thủ công bên dưới.",
                    );
                })
              }
            >
              {busy ? "Đang xử lý…" : "⌕  Quét citation từ tab hiện tại"}
            </button>
            <small>Bấm icon extension trên tab AI trước khi quét.</small>
          </section>
          {citations.length > 0 && (
            <section>
              <div className="section-label">
                NGUỒN TÌM THẤY <span>{citations.length}</span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => setCitations([])}
                >
                  Xóa danh sách
                </button>
              </div>
              <p className="hint">
                Liên kết được đọc từ câu trả lời; hãy kiểm tra và sửa nhận định
                trước khi tìm.
              </p>
              <div className="citations">
                {citations.map((c, i) => (
                  <button
                    className="citation"
                    key={`${c.url}\n${c.claim}\n${i}`}
                    onClick={() => {
                      setUrl(c.url);
                      setClaim(c.claim);
                      setQuote(c.quote ?? "");
                      setContext(c.context ?? "");
                    }}
                  >
                    <span>
                      {c.provider} · {new URL(c.url).hostname}
                    </span>
                    <strong>{c.title || "Mở nguồn"}</strong>
                    <p>{c.claim.slice(0, 180)}</p>
                  </button>
                ))}
              </div>
            </section>
          )}
          <section className="form">
            <div className="section-label">
              TÌM TRÊN MỘT NGUỒN <span>01</span>
            </div>
            <label htmlFor="url">Đường dẫn nguồn</label>
            <input
              id="url"
              type="url"
              placeholder="https://example.org/research"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setContext("");
              }}
              maxLength={5000}
            />
            <label htmlFor="claim">Nhận định cần đối chiếu</label>
            <textarea
              id="claim"
              placeholder="Dán câu trả lời hoặc nhận định của AI…"
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              maxLength={10000}
            />
            <label htmlFor="quote">
              Trích đoạn nguyên văn <span>không bắt buộc</span>
            </label>
            <textarea
              id="quote"
              className="quote"
              placeholder="Nếu citation có sẵn đoạn trích, dán vào đây."
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              maxLength={10000}
            />
            <button
              className="primary"
              disabled={busy || !url || !(quote || claim)}
              onClick={start}
            >
              Mở nguồn & tìm đoạn ↗
            </button>
            <p className="hint">
              Chỉ tự highlight khi có một đoạn khớp với trích dẫn nguyên văn bạn
              nhập.
            </p>
          </section>
          {latest && (
            <button className="resume" onClick={() => setView("history")}>
              Tiếp tục phiên gần nhất →
            </button>
          )}
        </>
      ) : (
        <section>
          <div className="section-label">
            CÁC NGUỒN ĐÃ MỞ
            <button
              className="text-button"
              onClick={() =>
                act(async () => {
                  const data = await browser.storage.session.get(null);
                  await browser.storage.session.remove(
                    Object.entries(data)
                      .filter(
                        ([k, v]) =>
                          k.startsWith("task:") &&
                          ["completed", "failed"].includes((v as Task).status),
                      )
                      .map(([k]) => k),
                  );
                })
              }
            >
              Xóa đã xong
            </button>
          </div>
          {!tasks.length && (
            <div className="empty">
              <span>⌕</span>
              <h2>Chưa có nguồn nào</h2>
              <p>Quét citation hoặc nhập một đường dẫn để bắt đầu.</p>
              <button onClick={() => setView("explore")}>
                Khám phá nguồn →
              </button>
            </div>
          )}
          {tasks.map((task) => (
            <article className="task" key={task.id}>
              <div className="task-top">
                <span className={`status ${task.status}`}>
                  {
                    {
                      opening: "Đang mở",
                      matching: "Đang tìm",
                      completed: "Đã tìm",
                      failed: "Cần xử lý",
                    }[task.status]
                  }
                </span>
                <span>
                  {new Date(task.createdAt).toLocaleTimeString("vi", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <a
                href={task.actualUrl || task.url}
                target="_blank"
                rel="noreferrer"
              >
                {new URL(task.actualUrl || task.url).hostname} ↗
              </a>
              <p className="claim">{task.quote || task.claim}</p>
              {task.error && <p className="alert">{task.error}</p>}
              {task.status === "completed" && !task.candidates?.length && (
                <p className="notice">
                  Chưa tìm thấy đoạn phù hợp trong nội dung đọc được. Nguồn có
                  thể tải chậm, yêu cầu đăng nhập hoặc dùng cách diễn đạt khác.
                </p>
              )}
              {task.candidates?.map((c, i) => (
                <div className="evidence" key={i}>
                  <span className="eyebrow">
                    {c.method === "semantic"
                      ? "ĐOẠN AI GỢI Ý"
                      : c.method === "lexical"
                        ? "ĐOẠN CÓ THỂ LIÊN QUAN"
                        : "KHỚP VĂN BẢN"}
                    {c.page ? ` · TRANG ${c.page}` : ""}
                  </span>
                  <p>{c.text}</p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await send({
                          type: "HIGHLIGHT",
                          id: task.id,
                          index: i,
                        });
                      })
                    }
                  >
                    {c.page ? `Đến trang ${c.page} ↗` : "Đến đoạn này ↗"}
                  </button>
                </div>
              ))}
              {["completed", "failed"].includes(task.status) && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await send({ type: "RETRY", id: task.id });
                    })
                  }
                >
                  ↻ Tìm lại trên tab nguồn
                </button>
              )}
            </article>
          ))}
        </section>
      )}
      <footer>
        <span>◈ Xử lý trên trình duyệt của bạn</span>
        <p>
          Khớp văn bản không đồng nghĩa với xác minh nhận định. Hỗ trợ trang
          HTML và PDF (PDF nhảy tới đúng trang thay vì tô sáng).
        </p>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
