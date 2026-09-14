# Resource Explorer

Chrome extension giúp researcher mở citation và tìm đoạn văn trên nguồn gốc. WXT + React + TypeScript, Manifest V3. Matching chạy cục bộ, không API key, backend, telemetry hoặc remote code.

## Cài đặt

Yêu cầu Bun, Node.js hiện đại và Chrome 120+ (nên dùng Chrome stable mới nhất).

```sh
bun install
bun run build
```

1. Mở `chrome://extensions`, bật **Developer mode**.
2. Chọn **Load unpacked**, chọn `.output/chrome-mv3` trong dự án.
3. Pin Resource Explorer trên toolbar.
4. Mở ChatGPT, Gemini, Claude hoặc Grok (grok.com); bấm icon extension để mở side panel và cấp `activeTab` cho tab đó.
5. Bấm **Quét citation từ tab hiện tại**. Chọn nguồn, kiểm tra/sửa nhận định, sau đó **Mở nguồn & tìm đoạn**. Với **Gemini**, bấm mở thẻ nguồn trên trang trước khi quét (xem [Giới hạn](#giới-hạn)); có thể quét nhiều lần để cộng dồn.
6. Chấp nhận quyền domain nguồn. Extension mở tab, tìm và hiển thị kết quả trong panel.

Có thể nhập URL và nhận định thủ công. Nếu có **trích dẫn nguyên văn**, nhập vào ô tương ứng: một kết quả exact/normalized duy nhất sẽ tự scroll và highlight. Ứng viên lexical hoặc nhiều đoạn trùng nhau cần chọn **Đến đoạn này**.

### Tùy chọn: tìm đoạn bằng AI (Gemini)

Match cục bộ dựa trên trùng từ vựng nên hay trượt khi nguồn được **diễn giải lại**. Nếu cấu hình API key Gemini, extension sẽ **tự động** gọi Gemini trên mỗi lần tìm: gửi văn bản trang nguồn (kèm ngữ cảnh hội thoại nếu quét từ trang chat) để lấy các đoạn liên quan chép nguyên văn, rồi định vị lại và highlight như bình thường. Kết quả AI được gộp cùng match cục bộ nhằm tìm được nhiều đoạn liên quan nhất có thể.

1. Sao chép `.env.example` thành `.env`, điền `WXT_GEMINI_API_KEY` (lấy tại <https://aistudio.google.com/apikey>). Key được nhúng lúc build — chỉ dùng cho bản cá nhân.
2. Chạy lại `bun run build` (hoặc `bun run dev`). Không còn key thì extension chỉ chạy match cục bộ như trước.

> ⚠️ Khi có key, nội dung trang nguồn và ngữ cảnh hội thoại được gửi tới Google — phá vỡ mặc định "chỉ xử lý cục bộ". Bỏ key khỏi `.env` và build lại để tắt hoàn toàn.

```sh
bun run dev       # WXT development
bun run check     # TypeScript
bun run test      # Unit + DOM tests
bun run build
bun run test:e2e  # Cần bunx playwright install chromium lần đầu
bun run zip       # Đóng gói extension
```

## Kiến trúc

- `entrypoints/background.ts`: điều phối task/tab, recovery qua alarm, kiểm tra sender.
- `entrypoints/ai.ts` + `src/adapters.ts`: on-demand DOM adapters, không quét nền.
- `entrypoints/source.ts`: đọc HTML, tìm/highlight trong isolated world.
- `src/matcher.ts`: normalized exact và lexical candidate ranking; giữ offset Unicode.
- `src/dom.ts`: text index → DOM Range xuyên text node → CSS Custom Highlight.
- `entrypoints/sidepanel/`: UI tiếng Việt, form thủ công, danh sách phiên và kết quả.

Task lưu riêng theo ID trong `chrome.storage.session`, tồn tại qua service worker restart nhưng mất khi browser khởi động lại/extension reload. Alarm phục hồi task dang dở và dọn task quá một giờ. Không tự đóng tab người dùng.

## Giới hạn

- ChatGPT/Claude/Grok (grok.com) nhúng link nguồn dạng `<a href>` nên quét được trực tiếp. **Gemini giấu URL nguồn khỏi DOM** — chỉ hiện tên (ví dụ "PYS Travel") trên chip; URL thật (kèm `#:~:text=` trỏ đúng đoạn) chỉ xuất hiện khi bạn **bấm mở thẻ nguồn**. Vì vậy Gemini chạy **bán tự động**: mở thẻ nguồn muốn tra rồi bấm quét — mỗi lần quét cộng dồn vào danh sách. Nguồn có tên là hostname (ví dụ `www.studocu.vn`) được lấy tự động ở dạng domain gốc.
- Adapter là **heuristic DOM**, kiểm thử bằng fixture, chưa xác minh đầy đủ với tài khoản live từng dịch vụ. Nhập thủ công nếu link render ngoài vùng câu trả lời.
- Link ngoài có thể không phải citation; claim được suy từ đoạn gần link. Người dùng cần kiểm tra lại.
- Chỉ hỗ trợ HTML và DOM đọc được. Chưa hỗ trợ PDF, OCR, iframe khác origin, closed Shadow DOM, paywall hoặc nội dung yêu cầu đăng nhập.
- Lexical matching chưa hiểu ngữ nghĩa, phủ định hoặc khác ngôn ngữ. Khớp văn bản không chứng nhận nguồn hỗ trợ nhận định. Không hiển thị điểm như phần trăm độ tin cậy.
- Giới hạn khoảng 1 triệu ký tự; thử lại vài lần cho trang động. Trang thay đổi sau matching cần bấm **Tìm lại**.
- Redirect sang domain chưa cấp quyền: mở tab nguồn, bấm icon extension để cấp activeTab rồi thử lại. Thu hồi quyền domain trong quản lý extension của Chrome.
- Phiên dùng chung các cửa sổ cùng profile; chưa có cloud sync hoặc thư viện nghiên cứu lâu dài.

## Kiểm thử

15 unit/DOM tests: Unicode tổ hợp, emoji UTF-16, nhiều text node, nguồn trùng, no match, lexical, adapter và URL không hợp lệ.

`tests/extension.e2e.mjs` chạy extension đã build trong Chromium, với bản sao manifest chỉ cho kiểm thử có quyền localhost và ChatGPT fixture. Kiểm tra mở nguồn, quote tiếng Việt xuyên thẻ, CSS highlight, scroll, no match, panel reload và scan adapter qua scripting API. Ảnh ở `artifacts/`. **Hộp thoại xin quyền và side panel native cần kiểm tra thủ công**; E2E mở panel trong tab extension.

Checklist trước release: quyền đồng ý/từ chối, redirect khác domain, đóng tab khi loading, dừng worker, nhiều task đồng thời, citation thực tế từng provider, trang dài/dynamic và thu hồi quyền. Chưa có benchmark 120 mẫu hoặc beta researcher.

Đã chạy thành công: TypeScript, 15 tests, production build/zip và E2E trên Edge 152 (Chromium). Chrome for Testing tải về gặp lỗi Windows Side-by-Side trên máy phát triển này; có thể chọn executable Chromium khác qua biến môi trường:

```powershell
$env:CHROME_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
bun run test:e2e
```
