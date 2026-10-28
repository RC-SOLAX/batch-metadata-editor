const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { openSession, readCurrent, supports, endShared } = require('../src/writers/exiftool');
const { FIELDS, typeOfTag } = require('../src/fields');
const { familyOf } = require('../src/formats');
const { normalise } = require('../src/values');
const { fixture, tmpDir, sha256, sampleFor, readRaw, rawEt } = require('./helpers/common');

const session = openSession({ customNames: ['Batch_Ref'] });
after(async () => {
  await session.end();
  await endShared();
  await rawEt.end();
});

// Every tag the catalogue writes for this file's family, with a sample value.
function allTagsFor(file) {
  const family = familyOf(file);
  const ext = path.extname(file).toLowerCase();
  const tags = {};
  for (const f of FIELDS) {
    for (const tag of f.targets[family] || []) {
      if (!(tag in tags) && supports(ext, tag)) tags[tag] = sampleFor(f, tag);
    }
  }
  return tags;
}

function mismatches(tags, read, family) {
  const out = [];
  for (const [tag, want] of Object.entries(tags)) {
    const type = typeOfTag(tag, family);
    const a = normalise(want, type);
    const b = normalise(read[tag], type);
    if (a !== b) out.push(`${tag}: wrote ${JSON.stringify(a)} read ${JSON.stringify(b)}`);
  }
  return out;
}

for (const name of ['a.pdf', 'a.jpg', 'a.png', 'a.webp', 'a.tiff', 'a.heic', 'a.mp4', 'a.m4a', 'a.mov']) {
  describe(name, () => {
    test('every catalogue tag round-trips and the source is untouched', async () => {
      const src = fixture(name);
      const before = sha256(src);
      const dest = path.join(tmpDir(), name);
      const tags = allTagsFor(src);
      assert.ok(Object.keys(tags).length >= 10);
      await session.write(src, dest, tags, { strip: false });
      const read = await session.read(dest);
      assert.deepEqual(mismatches(tags, read, familyOf(src)), []);
      assert.equal(sha256(src), before);
    });
  });
}

test('supports() refuses IPTC outside JPEG/TIFF', () => {
  assert.equal(supports('.jpg', 'IPTC:City'), true);
  assert.equal(supports('.tif', 'IPTC:City'), true);
  assert.equal(supports('.png', 'IPTC:City'), false);
  assert.equal(supports('.webp', 'IPTC:City'), false);
  assert.equal(supports('.png', 'XMP-dc:Title'), true);
});

test('custom fields are written to PDF Info and XMP', async () => {
  const dest = path.join(tmpDir(), 'a.pdf');
  await session.write(fixture('a.pdf'), dest, { 'PDF:Batch_Ref': 'R-1', 'XMP-bme:Batch_Ref': 'R-1' }, { strip: false });
  const raw = await readRaw(dest);
  assert.equal(raw['PDF:Batch_Ref'], 'R-1');
  assert.equal(raw['XMP-bme:Batch_Ref'], 'R-1');
});

test('a null value clears the tag', async () => {
  const dir = tmpDir();
  const one = path.join(dir, 'one.jpg');
  const two = path.join(dir, 'two.jpg');
  await session.write(fixture('a.jpg'), one, { 'IPTC:City': 'Hull' }, { strip: false });
  assert.equal((await readRaw(one))['IPTC:City'], 'Hull');
  await session.write(one, two, { 'IPTC:City': null }, { strip: false });
  assert.equal((await readRaw(two))['IPTC:City'], undefined);
});

test('strip removes existing metadata before writing', async () => {
  const dir = tmpDir();
  const one = path.join(dir, 'one.jpg');
  const two = path.join(dir, 'two.jpg');
  await session.write(fixture('a.jpg'), one, { 'IFD0:Make': 'OldCam' }, { strip: false });
  await session.write(one, two, { 'XMP-dc:Title': 'New' }, { strip: true });
  const raw = await readRaw(two);
  assert.equal(raw['IFD0:Make'], undefined);
  assert.equal(raw['XMP-dc:Title'], 'New');
});

test('unicode round-trip', async () => {
  const text = 'Café — 東京 ✓';
  const dest = path.join(tmpDir(), 'a.jpg');
  await session.write(fixture('a.jpg'), dest, {
    'XMP-dc:Title': text, 'IPTC:ObjectName': text, 'IFD0:XPTitle': text,
  }, { strip: false });
  const raw = await readRaw(dest);
  assert.equal(raw['XMP-dc:Title'], text);
  assert.equal(raw['IPTC:ObjectName'], text);
  assert.equal(raw['IFD0:XPTitle'], text);
});

test('an existing destination is never overwritten', async () => {
  const dest = path.join(tmpDir(), 'a.jpg');
  fs.writeFileSync(dest, 'keep');
  await assert.rejects(session.write(fixture('a.jpg'), dest, { 'XMP-dc:Title': 'x' }, { strip: false }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'keep');
});

test('readCurrent returns group-qualified tags', async () => {
  const cur = await readCurrent(fixture('a.pdf'));
  assert.ok('PDF:Producer' in cur);
});
