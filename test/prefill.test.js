const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prefillFromFile, readForPrefill } = require('../src/prefill');
const { runBatch } = require('../src/batch');
const { endShared } = require('../src/writers/exiftool');
const { fixture, tmpDir, rawEt } = require('./helpers/common');

after(async () => {
  await endShared();
  await rawEt.end();
});

const v = (value) => ({ value, clear: false });

// Give a fixture known metadata through the app itself, then read it back for the form.
async function tagged(name, fields, custom = []) {
  const out = tmpDir();
  const src = tmpDir();
  const p = path.join(src, name);
  fs.copyFileSync(fixture(name), p);
  const [r] = await runBatch({ files: [{ path: p }], form: { fields, custom }, outDir: out });
  assert.equal(r.ok, true, r.error);
  return path.join(out, name);
}

test('a PDF fills Common and PDF fields, with dates and lists in form shape', async () => {
  const file = await tagged('a.pdf', {
    title: v('Safety Briefing'), author: v('Ross'), keywords: v('safety; site'),
    pdf_creator: v('Word'), pdf_createdate: v('2025-04-01T10:07'),
  });
  const { fields } = await readForPrefill(file);
  assert.equal(fields.title, 'Safety Briefing');
  assert.equal(fields.pdf_title, 'Safety Briefing');
  assert.equal(fields.author, 'Ross');
  assert.equal(fields.keywords, 'safety; site');
  assert.equal(fields.pdf_creator, 'Word');
  assert.equal(fields.pdf_createdate, '2025-04-01T10:07');
  assert.match(fields.file_modified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('an Office file fills core, app and custom properties', async () => {
  const file = await tagged('a.docx', { title: v('Report'), publisher: v('CBRE'), office_manager: v('Laura') },
    [{ name: 'Batch_Ref', value: 'R-7', clear: false }]);
  const { fields, custom } = await readForPrefill(file);
  assert.equal(fields.title, 'Report');
  assert.equal(fields.office_company, 'CBRE');
  assert.equal(fields.office_manager, 'Laura');
  assert.deepEqual(custom.filter((c) => c.name === 'Batch_Ref'), [{ name: 'Batch_Ref', value: 'R-7' }]);
});

test('an MP3 fills tags, the star rating and TXXX custom fields (not cover art)', async () => {
  const file = await tagged('a.mp3', { title: v('Song'), rating: v('4'), mp3_year: v('2026') },
    [{ name: 'Batch_Ref', value: 'R-8', clear: false }]);
  const { fields, custom } = await readForPrefill(file);
  assert.equal(fields.mp3_title, 'Song');
  assert.equal(fields.rating, '4');
  assert.equal(fields.mp3_year, '2026');
  assert.equal(fields.mp3_cover, undefined);
  assert.deepEqual(custom, [{ name: 'Batch_Ref', value: 'R-8' }]);
});

test('an image fills EXIF, IPTC, XMP, GPS and XMP custom fields', async () => {
  const file = await tagged('a.jpg', {
    title: v('Photo'), image_iptc_city: v('Hull'), image_gps: v({ lat: '53.74', lon: '-0.33', alt: '' }),
  }, [{ name: 'Shoot', value: 'S1', clear: false }]);
  const { fields, custom } = await readForPrefill(file);
  assert.equal(fields.title, 'Photo');
  assert.equal(fields.image_iptc_city, 'Hull');
  assert.equal(Number(fields.image_gps.lat).toFixed(2), '53.74');
  assert.equal(Number(fields.image_gps.lon).toFixed(2), '-0.33');
  assert.deepEqual(custom, [{ name: 'Shoot', value: 'S1' }]);
});

test('prefillFromFile maps choices case-insensitively and drops values a field cannot hold', () => {
  const { fields } = prefillFromFile({ 'PDF:Trapped': 'false', 'XMP-xmp:Rating': 'lots' }, 'pdf', null);
  assert.equal(fields.pdf_trapped, 'False');
  assert.equal(fields.rating, undefined);
});
