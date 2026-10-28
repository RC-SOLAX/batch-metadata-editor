// ExifTool edits PDFs incrementally: the old Info dictionary and XMP stream
// stay in the file, and anyone can roll the edit back. When the user strips
// or clears PDF metadata, the file is rewritten keeping only the objects the
// current document still reaches, so the old values are gone for good.

const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, PDFRef, PDFDict, PDFArray, PDFStream } = require('pdf-lib');

function reachable(context) {
  const seen = new Set();
  const stack = Object.values(context.trailerInfo).filter((v) => v instanceof PDFRef);
  const visit = (obj) => {
    if (obj instanceof PDFRef) stack.push(obj);
    else if (obj instanceof PDFDict) for (const v of obj.values()) visit(v);
    else if (obj instanceof PDFArray) for (const v of obj.asArray()) visit(v);
    else if (obj instanceof PDFStream) visit(obj.dict);
  };
  while (stack.length) {
    const ref = stack.pop();
    if (seen.has(ref.tag)) continue;
    seen.add(ref.tag);
    visit(context.lookup(ref));
  }
  return seen;
}

async function compactPdf(file) {
  let doc;
  try {
    doc = await PDFDocument.load(fs.readFileSync(file), { updateMetadata: false });
  } catch (e) {
    const why = /encrypt/i.test(e.message) ? 'it is encrypted' : e.message;
    throw new Error(`The old metadata in ${path.basename(file)} could not be removed permanently (${why})`);
  }
  const keep = reachable(doc.context);
  for (const [ref] of doc.context.enumerateIndirectObjects()) {
    if (!keep.has(ref.tag)) doc.context.delete(ref);
  }
  fs.writeFileSync(file, await doc.save({ updateFieldAppearances: false }));
}

module.exports = { compactPdf };
