const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');
const office = require('../src/writers/office');
const { FIELDS, typeOfTag } = require('../src/fields');
const { normalise } = require('../src/values');
const { fixture, tmpDir, sha256, sampleFor } = require('./helpers/common');

const PY = process.platform === 'win32' ? 'python' : 'python3';
const readIndependent = (file) =>
  JSON.parse(execFileSync(PY, [path.join(__dirname, 'helpers', 'read_office.py'), file], { encoding: 'utf8' }));

function allOfficeTags() {
  const tags = {};
  for (const f of FIELDS) {
    for (const tag of f.targets.office || []) if (!(tag in tags)) tags[tag] = sampleFor(f, tag);
  }
  tags['custom:Batch_Ref'] = 'R-1';
  return tags;
}

function mismatches(tags, read) {
  const out = [];
  for (const [tag, want] of Object.entries(tags)) {
    const type = typeOfTag(tag, 'office');
    const a = normalise(want, type);
    const b = normalise(read[tag], type);
    if (a !== b) out.push(`${tag}: wrote ${JSON.stringify(a)} read ${JSON.stringify(b)}`);
  }
  return out;
}

for (const name of ['a.docx', 'a.xlsx', 'a.pptx', 'bare.docx']) {
  test(`${name}: every office tag round-trips, independently read`, async () => {
    const src = fixture(name);
    const before = sha256(src);
    const dest = path.join(tmpDir(), name);
    const tags = allOfficeTags();
    await office.write(src, dest, tags, { strip: false });
    assert.deepEqual(mismatches(tags, readIndependent(dest)), []);
    assert.deepEqual(mismatches(tags, await office.read(dest)), []);
    assert.equal(sha256(src), before);
  });
}

test('bare.docx gains each docProps part exactly once in content types and rels', async () => {
  const dest = path.join(tmpDir(), 'bare.docx');
  await office.write(fixture('bare.docx'), dest, { 'core:title': 'T', 'app:Company': 'C', 'custom:X': 'Y' }, { strip: false });
  const r = readIndependent(dest);
  for (const part of ['core.xml', 'app.xml', 'custom.xml']) {
    assert.equal(r.__content_types.split(`/docProps/${part}`).length - 1, 1, part);
    assert.equal(r.__rels.split(`docProps/${part}`).length - 1, 1, part);
  }
  // A second write to a file that now has the parts adds nothing again.
  const again = path.join(tmpDir(), 'again.docx');
  await office.write(dest, again, { 'core:title': 'T2' }, { strip: false });
  const r2 = readIndependent(again);
  assert.equal(r2.__content_types.split('/docProps/core.xml').length - 1, 1);
  assert.equal(r2['core:title'], 'T2');
  assert.equal(r2['custom:X'], 'Y');
});

test('a null value clears the property', async () => {
  const dir = tmpDir();
  const one = path.join(dir, 'one.docx');
  const two = path.join(dir, 'two.docx');
  await office.write(fixture('a.docx'), one, { 'core:category': 'Cat', 'custom:Gone': 'x' }, { strip: false });
  await office.write(one, two, { 'core:category': null, 'custom:Gone': null }, { strip: false });
  const r = readIndependent(two);
  assert.ok(!r['core:category']);
  assert.equal(r['custom:Gone'], undefined);
});

test('strip removes existing properties first', async () => {
  const dest = path.join(tmpDir(), 'a.docx');
  await office.write(fixture('a.docx'), dest, { 'core:title': 'Only' }, { strip: true });
  const r = readIndependent(dest);
  assert.equal(r['core:title'], 'Only');
  assert.ok(!r['core:creator'], 'creator from the fixture should be gone');
  assert.ok(!r['app:Template'], 'template from the fixture should be gone');
});

test('unicode round-trip', async () => {
  const text = 'Café — 東京 ✓ <&>';
  const dest = path.join(tmpDir(), 'a.xlsx');
  await office.write(fixture('a.xlsx'), dest, { 'core:title': text, 'app:Company': text, 'custom:Note': text }, { strip: false });
  const r = readIndependent(dest);
  assert.equal(r['core:title'], text);
  assert.equal(r['app:Company'], text);
  assert.equal(r['custom:Note'], text);
});

test('the output is still a valid zip with the document intact', async () => {
  const dest = path.join(tmpDir(), 'a.pptx');
  await office.write(fixture('a.pptx'), dest, { 'core:title': 'T' }, { strip: false });
  const zip = await JSZip.loadAsync(fs.readFileSync(dest));
  assert.ok(zip.file('ppt/presentation.xml'));
});

test('an empty file is rejected with a readable message', async () => {
  const dest = path.join(tmpDir(), 'empty.docx');
  await assert.rejects(office.write(fixture('empty.docx'), dest, { 'core:title': 'T' }, {}), /not a valid Office file/);
  assert.equal(fs.existsSync(dest), false, 'no half-written output is left behind');
});

test('an existing destination is never overwritten', async () => {
  const dest = path.join(tmpDir(), 'a.docx');
  fs.writeFileSync(dest, 'keep');
  await assert.rejects(office.write(fixture('a.docx'), dest, { 'core:title': 'x' }, {}), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'keep');
});

test('dates are entered in local time and stored as UTC (UK summer time)', async () => {
  const tz = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    const dest = path.join(tmpDir(), 'a.docx');
    await office.write(fixture('a.docx'), dest, { 'core:created': '2026-07-01T09:30' }, {});
    assert.equal(readIndependent(dest)['core:created'], '2026-07-01T08:30:00Z');
    assert.equal((await office.read(dest))['core:created'], '2026-07-01T09:30');
  } finally {
    if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
  }
});
