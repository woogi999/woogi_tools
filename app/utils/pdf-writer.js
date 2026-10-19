// Writing simple text-and-picture PDFs with pdf-lib: the few drawing calls the
// File Converter (plain text to PDF) and User Profiling (the report) need.
// Coordinates are in points from the top-left corner of an A4 page, and text
// is placed by its baseline, the way the old jsPDF-based code expected.
import {
  PDFDocument,
  PDFName,
  PDFString,
  PageSizes,
  StandardFonts,
  rgb,
} from 'pdf-lib';

const FONTS = {
  normal: StandardFonts.Helvetica,
  bold: StandardFonts.HelveticaBold,
};

export async function createPdf() {
  const pdf = await PDFDocument.create();
  const fonts = {};
  for (const [style, name] of Object.entries(FONTS))
    fonts[style] = await pdf.embedFont(name);
  const [width, height] = PageSizes.A4;

  let page = pdf.addPage(PageSizes.A4);
  let font = fonts.normal;
  let size = 16;
  let colour = rgb(0, 0, 0);
  // The standard fonts only carry Latin-1 (WinAnsi): anything else is
  // printed as a question mark rather than stopping the whole document.
  const known = (f) => new Set(f.getCharacterSet());
  const charsets = { normal: known(fonts.normal), bold: known(fonts.bold) };
  let charset = charsets.normal;
  const clean = (text) =>
    [...String(text)]
      .map((c) => (charset.has(c.codePointAt(0)) ? c : '?'))
      .join('');

  const doc = {
    width,
    height,

    addPage() {
      page = pdf.addPage(PageSizes.A4);
      return doc;
    },

    setFont(_family, style = 'normal') {
      const key = style === 'bold' ? 'bold' : 'normal';
      font = fonts[key];
      charset = charsets[key];
      return doc;
    },

    setFontSize(points) {
      size = points;
      return doc;
    },

    // A grey level (0 to 255), or red, green and blue (each 0 to 255).
    setTextColor(r, g = r, b = r) {
      colour = rgb(r / 255, g / 255, b / 255);
      return doc;
    },

    // Breaks text into lines no wider than `maxWidth` at the current font
    // and size: at line breaks, then between words, then inside a word that
    // is too long on its own.
    splitTextToSize(text, maxWidth) {
      const fits = (s) => font.widthOfTextAtSize(clean(s), size) <= maxWidth;
      const lines = [];
      for (const paragraph of String(text).split(/\r?\n/)) {
        let line = '';
        for (const word of paragraph.split(' ')) {
          const next = line ? `${line} ${word}` : word;
          if (fits(next)) {
            line = next;
            continue;
          }
          if (line) lines.push(line);
          line = word;
          while (line && !fits(line)) {
            let cut = line.length - 1;
            while (cut > 1 && !fits(line.slice(0, cut))) cut--;
            lines.push(line.slice(0, cut));
            line = line.slice(cut);
          }
        }
        lines.push(line);
      }
      return lines;
    },

    text(value, x, y) {
      page.drawText(clean(value), {
        x,
        y: height - y,
        size,
        font,
        color: colour,
      });
      return doc;
    },

    textWithLink(value, x, y, { url }) {
      doc.text(value, x, y);
      const w = font.widthOfTextAtSize(clean(value), size);
      const link = pdf.context.register(
        pdf.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [x, height - y - size * 0.25, x + w, height - y + size],
          Border: [0, 0, 0],
          A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
        }),
      );
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (annots) annots.push(link);
      else page.node.set(PDFName.of('Annots'), pdf.context.obj([link]));
      return doc;
    },

    // A JPEG data: URL, placed by its top-left corner.
    async addImage(dataUrl, _format, x, y, w, h) {
      const bytes = await (await fetch(dataUrl)).arrayBuffer();
      const image = await pdf.embedJpg(bytes);
      page.drawImage(image, { x, y: height - y - h, width: w, height: h });
      return doc;
    },

    async blob() {
      return new Blob([await pdf.save()], { type: 'application/pdf' });
    },
  };
  return doc;
}
