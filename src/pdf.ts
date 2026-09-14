// Pure helpers for turning pdf.js page text into the flat string that
// matcher.match() expects, while remembering where each page starts so a
// candidate offset can be mapped back to a 1-based page number.
export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}
export interface PdfExtract {
  text: string;
  // starts[i] is the character offset in `text` where page (i + 1) begins.
  starts: number[];
}
export function assemblePdfText(pages: PdfTextItem[][]): PdfExtract {
  let text = "";
  const starts: number[] = [];
  for (const items of pages) {
    // Keep pages on separate lines so probes() can treat them independently.
    if (text && !text.endsWith("\n")) text += "\n";
    starts.push(text.length);
    for (const item of items) {
      text += item.str;
      // pdf.js splits a visual line into several runs with no guaranteed
      // spacing, so pad every run with whitespace and let normalize() collapse
      // it. Missing spaces would glue words together and break tokenisation;
      // extra spaces are harmless.
      text += item.hasEOL ? "\n" : " ";
    }
  }
  return { text, starts };
}
export function pageAt(starts: number[], offset: number): number {
  let page = 1;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= offset) page = i + 1;
    else break;
  }
  return page;
}
