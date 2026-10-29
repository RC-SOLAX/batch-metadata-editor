// "Wipe mode": after the form is filled from a file, Apply keeps only what
// the user edited or ticked Keep; everything else in each copy is removed.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ExifTool } = require('exiftool-vendored');
const { runBatch } = require('../src/batch');
const { fixture, tmpDir, readRaw, rawEt } = require('./helpers/common');

const PY = process.platform === 'win32' ? 'python' : 'python3';
const readOffice = (file) =>
  JSON.parse(require('node:child_process').execFileSync(PY, [path.join(__dirname, 'helpers', 'read_office.py'), file], { encoding: 'utf8' }));

after(() => rawEt.end());

const v = (value) => ({ value, clear: false });
const wipe = (files, outDir, fields, keep = [], keepCustom = [], custom = []) =>
  runBatch({ files: files.map((p) => ({ path: p })), form: { fields, custom }, keep: { fields: keep, custom: keepCustom }, wipe: true, outDir });

// Set metadata on a copy of a fixture directly with ExifTool.
async function withExif(name, tags, as = name) {
  const p = path.join(tmpDir(), as);
  fs.copyFileSync(fixture(name), p);
  const et = new ExifTool({ maxProcs: 1 });
  await et.write(p, tags, { writeArgs: ['-overwrite_original'] });
  await et.end();
  return p;
}

test('PDF: edited fields are written, kept fields survive, everything else is wiped', async () => {
  const p = await withExif('a.pdf', {
    'PDF:Title': 'Old title', 'XMP-dc:Title': 'Old title', 'PDF:Author': 'Ann', 'XMP-dc:Creator': 'Ann',
    'PDF:Subject': 'Gone', 'PDF:Keywords': 'gone', 'XMP-xmpMM:DocumentID': 'uuid:no-box-for-this',
  });
  const out = tmpDir();
  const [r] = await wipe([p], out, { title: v('New title') }, ['author']);
  assert.equal(r.ok, true, r.error);
  const raw = await readRaw(path.join(out, 'a.pdf'));
  assert.equal(raw['PDF:Title'], 'New title');
  assert.equal(raw['XMP-dc:Title'], 'New title');
  assert.equal(raw['PDF:Author'], 'Ann');
  assert.equal(String(raw['XMP-dc:Creator']), 'Ann');
  assert.equal(raw['PDF:Subject'], undefined);
  assert.equal(raw['PDF:Keywords'], undefined);
  assert.equal(raw['XMP-xmpMM:DocumentID'], undefined, 'metadata with no box is wiped too');
});

test('JPG: keeps the kept, rotation and colour profile; wipes camera details and GPS', async () => {
  const p = await withExif('oriented.jpg', {
    'IPTC:City': 'Hull', 'XMP-dc:Title': 'Old', 'IFD0:Model': 'Cam X', 'ExifIFD:SerialNumber': '12345',
    'GPS:GPSLatitude': 53.7, 'GPS:GPSLatitudeRef': 'N',
  });
  // The custom XMP namespace needs the app's config, so set Shoot through the app.
  const out0 = tmpDir();
  const [r0] = await runBatch({ files: [{ path: p }], form: { fields: {}, custom: [{ name: 'Shoot', value: 'S1', clear: false }] }, outDir: out0 });
  assert.equal(r0.ok, true, r0.error);
  const src = path.join(out0, 'oriented.jpg');
  const out = tmpDir();
  const [r] = await wipe([src], out, { title: v('New') }, ['image_iptc_city'], ['Shoot']);
  assert.equal(r.ok, true, r.error);
  const raw = await readRaw(path.join(out, 'oriented.jpg'));
  assert.equal(raw['XMP-dc:Title'], 'New');
  assert.equal(raw['IPTC:City'], 'Hull');
  assert.equal(raw['XMP-bme:Shoot'], 'S1');
  assert.equal(raw['IFD0:Orientation'], 'Rotate 90 CW');
  assert.equal(raw['ICC_Profile:ProfileDescription'], 'sRGB built-in');
  assert.equal(raw['IFD0:Model'], undefined);
  assert.equal(raw['ExifIFD:SerialNumber'], undefined);
  assert.equal(raw['GPS:GPSLatitude'], undefined);
});

test('Office: kept core and custom properties survive; the rest is wiped', async () => {
  const src0 = path.join(tmpDir(), 'a.docx');
  fs.copyFileSync(fixture('a.docx'), src0);
  const out0 = tmpDir();
  await runBatch({
    files: [{ path: src0 }],
    form: { fields: { author: v('Ann'), publisher: v('CBRE'), keywords: v('a; b') }, custom: [{ name: 'Ref', value: 'R1', clear: false }, { name: 'Other', value: 'X', clear: false }] },
    outDir: out0,
  });
  const out = tmpDir();
  const [r] = await wipe([path.join(out0, 'a.docx')], out, { title: v('New') }, ['author'], ['Ref']);
  assert.equal(r.ok, true, r.error);
  const o = readOffice(path.join(out, 'a.docx'));
  assert.equal(o['core:title'], 'New');
  assert.equal(o['core:creator'], 'Ann');
  assert.equal(o['custom:Ref'], 'R1');
  assert.ok(!o['core:keywords']);
  assert.ok(!o['app:Company']);
  assert.ok(!o['app:Template'], 'properties with no box are wiped too');
  assert.equal(o['custom:Other'], undefined);
});

test('MP3: kept album, rating and cover art survive; the rest is wiped', async () => {
  const src0 = path.join(tmpDir(), 'a.mp3');
  fs.copyFileSync(fixture('a.mp3'), src0);
  const out0 = tmpDir();
  await runBatch({
    files: [{ path: src0 }],
    form: { fields: { mp3_album: v('Album'), mp3_artist: v('Gone'), rating: v('4'), mp3_cover: v(fixture('a.jpg')) }, custom: [] },
    outDir: out0,
  });
  const out = tmpDir();
  const [r] = await wipe([path.join(out0, 'a.mp3')], out, { mp3_title: v('New') }, ['mp3_album', 'rating', 'mp3_cover']);
  assert.equal(r.ok, true, r.error);
  const raw = await readRaw(path.join(out, 'a.mp3'));
  assert.equal(raw['ID3v2_3:Title'], 'New');
  assert.equal(raw['ID3v2_3:Album'], 'Album');
  assert.match(String(raw['ID3v2_3:Popularimeter']), /Rating=196 /);
  assert.ok(raw['ID3v2_3:Picture']);
  assert.equal(raw['ID3v2_3:Artist'], undefined);
});

test('in a batch, each file keeps its own kept values and loses the rest', async () => {
  const a = await withExif('a.pdf', { 'PDF:Author': 'Ann', 'PDF:Subject': 'S-a' }, 'one.pdf');
  const b = await withExif('a.pdf', { 'PDF:Author': 'Bob', 'PDF:Subject': 'S-b' }, 'two.pdf');
  const out = tmpDir();
  const results = await wipe([a, b], out, { title: v('Shared title') }, ['author']);
  for (const r of results) assert.equal(r.ok, true, r.error);
  const one = await readRaw(path.join(out, 'one.pdf'));
  const two = await readRaw(path.join(out, 'two.pdf'));
  assert.equal(one['PDF:Author'], 'Ann');
  assert.equal(two['PDF:Author'], 'Bob');
  assert.equal(one['PDF:Title'], 'Shared title');
  assert.equal(two['PDF:Title'], 'Shared title');
  assert.equal(one['PDF:Subject'], undefined);
  assert.equal(two['PDF:Subject'], undefined);
});

test('a kept value that does not survive is reported, not passed', async () => {
  // Keep a field whose tag the file does not have: nothing to lose, still ok.
  const p = await withExif('a.pdf', { 'PDF:Author': 'Ann' });
  const out = tmpDir();
  const [r] = await wipe([p], out, {}, ['author', 'subject']);
  assert.equal(r.ok, true, r.error);
  assert.equal((await readRaw(path.join(out, 'a.pdf')))['PDF:Author'], 'Ann');
});
