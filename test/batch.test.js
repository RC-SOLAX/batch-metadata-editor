const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateBatch, resolveValues, outputPaths, runBatch, checkOutDir, MAX_FILES } = require('../src/batch');
const { fixture, tmpDir, readRaw, rawEt } = require('./helpers/common');

after(() => rawEt.end());

const form = (fields = {}, custom = []) => ({ fields, custom });
const v = (value) => ({ value, clear: false });

// --- validateBatch -----------------------------------------------------------

test('the 21st file is refused with the batch-full reason', () => {
  const paths = Array.from({ length: 21 }, (_, i) => `/x/f${i}.pdf`);
  const r = validateBatch(paths);
  assert.equal(MAX_FILES, 20);
  assert.equal(r.accepted.length, 20);
  assert.deepEqual(r.refused, [{ path: '/x/f20.pdf', reason: 'Batch is full (20 files max)' }]);
});

test('files already in the batch count toward the limit and are not added twice', () => {
  const current = Array.from({ length: 19 }, (_, i) => `/x/f${i}.pdf`);
  const r = validateBatch(['/x/f0.pdf', '/x/new.pdf', '/x/new2.pdf'], current);
  assert.deepEqual(r.accepted, ['/x/new.pdf']);
  assert.deepEqual(r.refused.map((x) => x.reason), ['Already in the batch', 'Batch is full (20 files max)']);
});

test('unsupported and legacy Office files are refused with their reasons', () => {
  const r = validateBatch(['/x/a.txt', '/x/a.doc', '/x/a.docx']);
  assert.deepEqual(r.accepted, ['/x/a.docx']);
  assert.deepEqual(r.refused, [
    { path: '/x/a.txt', reason: 'Unsupported file type' },
    { path: '/x/a.doc', reason: 'Old Office format: save as .docx/.xlsx/.pptx first' },
  ]);
});

// --- resolveValues -----------------------------------------------------------

test('a blank field is omitted and a cleared field becomes null', () => {
  const r = resolveValues(form({ title: v(''), subject: { value: '', clear: true }, keywords: v([]) }), 'pdf');
  assert.deepEqual(r, { 'PDF:Subject': null, 'XMP-dc:Description': null });
});

test('the format-tab field beats the common field, for its own family only', () => {
  const f = form({ title: v('Common'), pdf_title: v('PDF only') });
  assert.equal(resolveValues(f, 'pdf')['PDF:Title'], 'PDF only');
  assert.equal(resolveValues(f, 'pdf')['XMP-dc:Title'], 'PDF only');
  assert.equal(resolveValues(f, 'image')['XMP-dc:Title'], 'Common');
  assert.equal(resolveValues(f, 'office')['core:title'], 'Common');
});

test('the per-file title beats both', () => {
  const f = form({ title: v('Common'), pdf_title: v('PDF only') });
  const r = resolveValues(f, 'pdf', 'Mine');
  assert.equal(r['PDF:Title'], 'Mine');
  assert.equal(r['XMP-dc:Title'], 'Mine');
});

test('custom fields map to each family’s custom store', () => {
  const f = form({}, [{ name: 'Batch_Ref', value: 'R-1', clear: false }, { name: 'Old', value: '', clear: true }]);
  assert.deepEqual(resolveValues(f, 'pdf'), { 'PDF:Batch_Ref': 'R-1', 'XMP-bme:Batch_Ref': 'R-1', 'PDF:Old': null, 'XMP-bme:Old': null });
  assert.deepEqual(resolveValues(f, 'office'), { 'custom:Batch_Ref': 'R-1', 'custom:Old': null });
  assert.deepEqual(resolveValues(f, 'mp3'), { 'TXXX:Batch_Ref': 'R-1', 'TXXX:Old': null });
  assert.deepEqual(resolveValues(f, 'image'), { 'XMP-bme:Batch_Ref': 'R-1', 'XMP-bme:Old': null });
});

test('an invalid custom field name is rejected', () => {
  assert.throws(() => resolveValues(form({}, [{ name: 'Has space', value: 'x' }]), 'pdf'), /Invalid custom field name/);
});

// --- outputPaths ---------------------------------------------------------------

test('two files with the same name get distinct outputs', () => {
  const { dests, conflicts } = outputPaths(['/a/report.pdf', '/b/report.pdf', '/c/Report.PDF'], '/out', new Set());
  assert.deepEqual([...dests.values()].map((p) => path.basename(p)), ['report.pdf', 'report (2).pdf', 'Report (3).PDF']);
  assert.deepEqual(conflicts, []);
});

test('names already in the output folder are reported as conflicts', () => {
  const { conflicts } = outputPaths(['/a/report.pdf', '/a/other.pdf'], '/out', new Set(['report.pdf']));
  assert.deepEqual(conflicts.map((p) => path.basename(p)), ['report.pdf']);
});

// --- runBatch ------------------------------------------------------------------

function copyTo(dir, name, as = name) {
  const p = path.join(dir, as);
  fs.copyFileSync(fixture(name), p);
  return p;
}

test('a mixed batch writes every file and one corrupt file fails alone', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const files = ['a.pdf', 'corrupt.jpg', 'a.docx', 'a.mp3', 'a.png'].map((n) => ({ path: copyTo(src, n) }));
  const progress = [];
  const results = await runBatch({
    files, form: form({ title: v('Batch title'), author: v('Ross') }), outDir: out, strip: false,
  }, (p) => progress.push(p));
  const byName = Object.fromEntries(results.map((r) => [path.basename(r.path), r]));
  assert.equal(byName['corrupt.jpg'].ok, false);
  assert.ok(byName['corrupt.jpg'].error.length > 0);
  for (const n of ['a.pdf', 'a.docx', 'a.mp3', 'a.png']) assert.equal(byName[n].ok, true, `${n}: ${byName[n].error}`);
  assert.equal((await readRaw(path.join(out, 'a.pdf')))['PDF:Title'], 'Batch title');
  assert.equal(fs.existsSync(path.join(out, 'corrupt.jpg')), false, 'no output for a failed file');
  assert.equal(fs.readdirSync(out).filter((n) => n.includes('bme-')).length, 0, 'no temp files left');
  assert.ok(progress.length >= files.length);
});

test('IPTC fields are skipped (and reported) for PNG rather than failing it', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [r] = await runBatch({
    files: [{ path: copyTo(src, 'a.png') }], form: form({ image_iptc_city: v('Hull'), image_xmp_city: v('Hull') }), outDir: out,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.skipped, ['image_iptc_city']);
});

test('a value the format rejects is reported, never passed', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [r] = await runBatch({
    files: [{ path: copyTo(src, 'a.mp4') }], form: form({ media_track: v('three'), title: v('Fine') }), outDir: out,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.mismatched, ['media_track']);
  assert.match(r.error, /Track number/);
  assert.equal((await readRaw(path.join(out, 'a.mp4')))['ItemList:Title'], 'Fine', 'the rest of the file is still written');
});

test('a file name with spaces and accents writes fine', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const p = copyTo(src, 'a.jpg', 'café test ø.jpg');
  const [r] = await runBatch({ files: [{ path: p, title: 'Per file' }], form: form({ title: v('Batch') }), outDir: out });
  assert.equal(r.ok, true, r.error);
  assert.equal((await readRaw(path.join(out, 'café test ø.jpg')))['XMP-dc:Title'], 'Per file');
});

test('same-named files from two folders both arrive', async () => {
  const a = tmpDir();
  const b = tmpDir();
  const out = tmpDir();
  const results = await runBatch({
    files: [{ path: copyTo(a, 'a.pdf', 'report.pdf') }, { path: copyTo(b, 'a.pdf', 'report.pdf') }],
    form: form({ title: v('T') }), outDir: out,
  });
  assert.ok(results.every((r) => r.ok));
  assert.deepEqual(fs.readdirSync(out).sort(), ['report (2).pdf', 'report.pdf']);
});

test('an output conflict is overwritten or numbered as asked', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const p = copyTo(src, 'a.pdf');
  fs.writeFileSync(path.join(out, 'a.pdf'), 'old');
  await runBatch({ files: [{ path: p }], form: form({ title: v('T') }), outDir: out, onConflict: 'suffix' });
  assert.equal(fs.readFileSync(path.join(out, 'a.pdf'), 'utf8'), 'old');
  assert.ok(fs.existsSync(path.join(out, 'a (edited).pdf')));
  await runBatch({ files: [{ path: p }], form: form({ title: v('T') }), outDir: out, onConflict: 'overwrite' });
  assert.notEqual(fs.readFileSync(path.join(out, 'a.pdf'), 'utf8'), 'old');
});

test('the output folder may not be a source folder', async () => {
  const src = tmpDir();
  const p = copyTo(src, 'a.pdf');
  await assert.rejects(runBatch({ files: [{ path: p }], form: form({ title: v('T') }), outDir: src }), /Output folder is a source folder/);
});

test('custom fields and clears reach the files', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const results = await runBatch({
    files: ['a.pdf', 'a.docx', 'a.mp3', 'a.jpg'].map((n) => ({ path: copyTo(src, n) })),
    form: form({ author: { value: '', clear: true } }, [{ name: 'Batch_Ref', value: 'R-9', clear: false }]),
    outDir: out,
  });
  for (const r of results) assert.equal(r.ok, true, `${r.path}: ${r.error}`);
  const pdf = await readRaw(path.join(out, 'a.pdf'));
  assert.equal(pdf['PDF:Batch_Ref'], 'R-9');
  assert.equal(pdf['PDF:Author'], undefined);
});

// --- Final-review fixes ---------------------------------------------------------

const { ExifTool } = require('exiftool-vendored');

test('strip leaves only the copies in the output folder, with the old metadata gone', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const names = ['oriented.jpg', 'secret.pdf', 'a.mp4'];
  const results = await runBatch({
    files: names.map((n) => ({ path: copyTo(src, n) })), form: form({ title: v('New') }), outDir: out, strip: true,
  });
  for (const r of results) assert.equal(r.ok, true, `${r.path}: ${r.error}`);
  assert.deepEqual(fs.readdirSync(out).sort(), [...names].sort(), 'no backup or temp files');
  assert.equal((await readRaw(path.join(out, 'oriented.jpg')))['IFD0:Make'], undefined);
});

test('strip keeps how a photo is displayed: orientation and colour profile', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [r] = await runBatch({ files: [{ path: copyTo(src, 'oriented.jpg') }], form: form({ title: v('T') }), outDir: out, strip: true });
  assert.equal(r.ok, true, r.error);
  const raw = await readRaw(path.join(out, 'oriented.jpg'));
  assert.equal(raw['IFD0:Orientation'], 'Rotate 90 CW');
  assert.equal(raw['ICC_Profile:ProfileDescription'], 'sRGB built-in');
  assert.equal(raw['IFD0:Make'], undefined);
});

// ExifTool edits PDFs incrementally; "-PDF-update:all=" rolls those edits back.
async function revertPdfEdits(file) {
  const et = new ExifTool({ maxProcs: 1 });
  try {
    await et.write(file, {}, { writeArgs: ['-PDF-update:all=', '-overwrite_original'] });
  } catch { /* nothing to revert is fine */ }
  const raw = await et.readRaw(file, ['-G1', '-a']);
  await et.end();
  return raw;
}

test('stripping a PDF removes the old values for good', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [r] = await runBatch({ files: [{ path: copyTo(src, 'secret.pdf') }], form: form({ title: v('New') }), outDir: out, strip: true });
  assert.equal(r.ok, true, r.error);
  const after = await revertPdfEdits(path.join(out, 'secret.pdf'));
  assert.equal(after['PDF:Author'], undefined);
  assert.notEqual(after['PDF:Title'], 'Old');
});

test('clearing a PDF field removes the old value for good', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [r] = await runBatch({
    files: [{ path: copyTo(src, 'secret.pdf') }], form: form({ author: { value: '', clear: true } }), outDir: out,
  });
  assert.equal(r.ok, true, r.error);
  assert.equal((await revertPdfEdits(path.join(out, 'secret.pdf')))['PDF:Author'], undefined);
});

test('number-like text such as 1.50 is verified as entered', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const results = await runBatch({
    files: ['a.pdf', 'a.jpg', 'a.png', 'a.mp4'].map((n) => ({ path: copyTo(src, n) })),
    form: form({ title: v('1.50') }, [{ name: 'Version', value: '2.10', clear: false }]),
    outDir: out,
  });
  for (const r of results) assert.equal(r.ok, true, `${path.basename(r.path)}: ${r.error}`);
});

test('MP3 year, date, track and disc in the wrong form are reported, not passed', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [bad] = await runBatch({
    files: [{ path: copyTo(src, 'a.mp3') }],
    form: form({ mp3_year: v('Twenty26'), mp3_track: v('three'), mp3_disc: v('1 of 2'), mp3_date: v('1st May'), mp3_title: v('Fine') }),
    outDir: out,
  });
  assert.equal(bad.ok, false);
  assert.deepEqual([...bad.mismatched].sort(), ['mp3_date', 'mp3_disc', 'mp3_track', 'mp3_year']);
  assert.equal((await readRaw(path.join(out, 'a.mp3')))['ID3v2_3:Title'], 'Fine', 'the valid fields are still written');

  const out2 = tmpDir();
  const [good] = await runBatch({
    files: [{ path: copyTo(src, 'a.mp3', 'b.mp3') }],
    form: form({ mp3_year: v('2026'), mp3_track: v('3/12'), mp3_disc: v('1'), mp3_date: v('0105') }),
    outDir: out2,
  });
  assert.equal(good.ok, true, good.error);
});

test('an ID3v2.4 recording time becomes a v2.3 year', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [r] = await runBatch({ files: [{ path: copyTo(src, 'v24.mp3') }], form: form({ title: v('New') }), outDir: out });
  assert.equal(r.ok, true, r.error);
  const raw = await readRaw(path.join(out, 'v24.mp3'));
  assert.equal(String(raw['ID3v2_3:Year']), '2019');
  assert.deepEqual(Object.keys(raw).filter((k) => /RecordingTime|^ID3v2_4:/.test(k)), []);
});

test('an output folder that is the source folder under another name is refused', async () => {
  const src = tmpDir();
  const p = copyTo(src, 'a.pdf');
  const alias = path.join(tmpDir(), 'alias');
  fs.symlinkSync(src, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const before = fs.readFileSync(p);
  assert.throws(() => checkOutDir([p], alias), /Output folder is a source folder/);
  await assert.rejects(runBatch({ files: [{ path: p }], form: form({ title: v('T') }), outDir: alias, onConflict: 'overwrite' }), /Output folder is a source folder/);
  assert.deepEqual(fs.readFileSync(p), before, 'the original is untouched');
});

test('checkOutDir reports a missing output folder plainly', () => {
  assert.throws(() => checkOutDir(['/x/a.pdf'], path.join(tmpDir(), 'gone')), /Output folder not found/);
});

// --- PDF fields reach the XMP copy, and Windows file dates -------------------------

// A PDF as Word or Acrobat writes it: the same properties in Info and in XMP.
async function twinnedPdf(dir) {
  const p = copyTo(dir, 'a.pdf', 'twinned.pdf');
  const et = new ExifTool({ maxProcs: 1 });
  await et.write(p, {
    'PDF:Title': 'Old', 'PDF:Author': 'Old', 'PDF:Subject': 'Old', 'PDF:Keywords': 'old',
    'PDF:Creator': 'Microsoft Word', 'PDF:Producer': 'Microsoft Word',
    'PDF:CreateDate': '2026:10:20 09:00:00', 'PDF:ModifyDate': '2026:10:20 09:00:00',
    'XMP-dc:Title': 'Old', 'XMP-dc:Creator': 'Old', 'XMP-dc:Description': 'Old', 'XMP-pdf:Keywords': 'old',
    'XMP-xmp:CreatorTool': 'Microsoft Word', 'XMP-pdf:Producer': 'Microsoft Word',
    'XMP-xmp:CreateDate': '2026:10:20 09:00:00', 'XMP-xmp:ModifyDate': '2026:10:20 09:00:00',
  }, { writeArgs: ['-overwrite_original'] });
  await et.end();
  return p;
}

test('PDF tab fields update the XMP copy that Acrobat shows, not just Info', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [r] = await runBatch({
    files: [{ path: await twinnedPdf(src) }],
    form: form({
      pdf_title: v('New title'), pdf_author: v('Ross Cassidy'), pdf_subject: v('New subject'), pdf_keywords: v('a; b'),
      pdf_creator: v('Ross Cassidy'), pdf_producer: v('Ross Cassidy'),
      pdf_createdate: v('2025-04-01T10:07'), pdf_modifydate: v('2025-04-01T10:07'),
    }),
    outDir: out,
  });
  assert.equal(r.ok, true, r.error);
  const raw = await readRaw(path.join(out, 'twinned.pdf'));
  assert.equal(raw['XMP-dc:Title'], 'New title');
  assert.equal(String(raw['XMP-dc:Creator']), 'Ross Cassidy');
  assert.equal(raw['XMP-dc:Description'], 'New subject');
  assert.match(raw['XMP-pdf:Keywords'], /^a[;,] ?b$/);
  assert.equal(raw['XMP-xmp:CreatorTool'], 'Ross Cassidy');
  assert.equal(raw['XMP-pdf:Producer'], 'Ross Cassidy');
  assert.match(raw['XMP-xmp:CreateDate'], /^2025:04:01 10:07/);
  assert.match(raw['XMP-xmp:ModifyDate'], /^2025:04:01 10:07/);
});

test('Common subject and keywords also update the PDF XMP copy', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [r] = await runBatch({ files: [{ path: await twinnedPdf(src) }], form: form({ subject: v('S'), keywords: v('x; y') }), outDir: out });
  assert.equal(r.ok, true, r.error);
  const raw = await readRaw(path.join(out, 'twinned.pdf'));
  assert.equal(raw['XMP-dc:Description'], 'S');
  assert.match(raw['XMP-pdf:Keywords'], /^x[;,] ?y$/);
});

const localStamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

test('File modified sets the date Windows shows in Properties, for every file type', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const names = ['a.pdf', 'a.docx', 'a.jpg', 'a.mp3', 'a.mp4'];
  const results = await runBatch({
    files: names.map((n) => ({ path: copyTo(src, n) })), form: form({ file_modified: v('2025-04-01T10:07') }), outDir: out,
  });
  for (const r of results) assert.equal(r.ok, true, `${path.basename(r.path)}: ${r.error}`);
  for (const n of names) assert.equal(localStamp(fs.statSync(path.join(out, n)).mtime), '2025-04-01T10:07', n);
});

test('File created sets the Windows creation date (Windows only; skipped and reported elsewhere)', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const [r] = await runBatch({ files: [{ path: copyTo(src, 'a.pdf') }], form: form({ file_created: v('2025-04-01T10:07') }), outDir: out });
  assert.equal(r.ok, true, r.error);
  if (process.platform === 'win32') {
    assert.equal(localStamp(fs.statSync(path.join(out, 'a.pdf')).birthtime), '2025-04-01T10:07');
    assert.deepEqual(r.skipped, []);
  } else {
    assert.deepEqual(r.skipped, ['file_created']);
  }
});
