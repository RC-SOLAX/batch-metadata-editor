const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateBatch, resolveValues, outputPaths, runBatch, MAX_FILES } = require('../src/batch');
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
  assert.deepEqual(r, { 'PDF:Subject': null });
});

test('the format-tab field beats the common field, for its own family only', () => {
  const f = form({ title: v('Common'), pdf_title: v('PDF only') });
  assert.equal(resolveValues(f, 'pdf')['PDF:Title'], 'PDF only');
  assert.equal(resolveValues(f, 'pdf')['XMP-dc:Title'], 'Common');
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
