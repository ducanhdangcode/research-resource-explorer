export interface TextIndex {
  text: string;
  entries: { node: Text; start: number; end: number }[];
}
export function indexDocument(root: Element): TextIndex {
  const entries: TextIndex["entries"] = [];
  let text = "";
  let previous: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const node = current as Text;
    const parent = node.parentElement;
    if (
      !parent ||
      parent.closest(
        'script,style,noscript,nav,header,footer,button,input,textarea,select,[hidden],[aria-hidden="true"],[contenteditable="true"]',
      )
    )
      continue;
    if (
      parent.checkVisibility &&
      !parent.checkVisibility({ checkVisibilityCSS: true })
    )
      continue;
    const block =
      parent.closest("p,li,blockquote,h1,h2,h3,h4,td,pre,div,section") ||
      parent;
    if (previous && previous !== block) text += "\n";
    previous = block;
    entries.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
    if (text.length > 1_000_000) break;
  }
  return { text, entries };
}
export function locate(index: TextIndex, start: number, end: number) {
  const first = index.entries.find((e) => e.start <= start && e.end > start);
  const last = index.entries.find((e) => e.start < end && e.end >= end);
  if (!first || !last || !first.node.isConnected || !last.node.isConnected)
    throw new Error("Nội dung đã thay đổi. Hãy tìm lại.");
  const range = document.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}
export function highlight(range: Range) {
  if (!CSS.highlights)
    throw new Error("Hãy cập nhật Chrome để hỗ trợ highlight.");
  let style = document.getElementById("resource-explorer-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "resource-explorer-style";
    style.textContent =
      "::highlight(resource-explorer) { background-color: #ffe082; color: #172525; }";
    document.documentElement.append(style);
  }
  CSS.highlights.set("resource-explorer", new Highlight(range));
  range.startContainer.parentElement?.scrollIntoView({
    block: "center",
    behavior: "smooth",
  });
}
