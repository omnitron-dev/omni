import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Decode the rendered content streams, not an embedded source attachment. */
export async function inspectPdf(bytes: Uint8Array) {
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, isEvalSupported: false });
  const pdf = await task.promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push({
        text: content.items.map((item) => 'str' in item ? item.str : '').join(' '),
        width: page.view[2]! - page.view[0]!, height: page.view[3]! - page.view[1]!,
        items: content.items,
      });
    }
    return { pages, text: pages.map((page) => page.text).join('\n') };
  } finally { await task.destroy(); }
}
