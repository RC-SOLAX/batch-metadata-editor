const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FIELDS, tagsFor, fieldsForTab, typeOfTag, FAMILY_TABS } = require('../src/fields');
const { normalise, toExif } = require('../src/values');

const FAMILIES = ['pdf', 'office', 'image', 'mp3', 'media'];

test('field ids are unique', () => {
  const ids = FIELDS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every field has at least one target tag', () => {
  for (const f of FIELDS) {
    const n = Object.values(f.targets).flat().length;
    assert.ok(n > 0, `${f.id} has no targets`);
  }
});

test('format-tab fields target only their own family', () => {
  for (const f of FIELDS.filter((f) => f.tab !== 'common')) {
    assert.deepEqual(Object.keys(f.targets), [FAMILY_TABS[f.tab]], f.id);
  }
});

test('common title maps across every family', () => {
  assert.deepEqual(tagsFor('title', 'pdf'), ['PDF:Title', 'XMP-dc:Title']);
  assert.deepEqual(tagsFor('title', 'office'), ['core:title']);
  assert.deepEqual(tagsFor('title', 'mp3'), ['title']);
  assert.deepEqual(tagsFor('title', 'nope'), []);
});

test('every family can be written through at least 15 fields', () => {
  for (const fam of FAMILIES) {
    const n = FIELDS.filter((f) => (f.targets[fam] || []).length).length;
    assert.ok(n >= 15, `${fam} has ${n}`);
  }
});

test('fieldsForTab returns only that tab', () => {
  const pdf = fieldsForTab('pdf');
  assert.ok(pdf.length > 0);
  assert.ok(pdf.every((f) => f.tab === 'pdf'));
});

test('choice fields carry their options', () => {
  for (const f of FIELDS.filter((f) => f.type === 'choice')) {
    assert.ok(Array.isArray(f.options) && f.options.length > 1, f.id);
  }
});

test('typeOfTag finds the type a tag is written as', () => {
  assert.equal(typeOfTag('IPTC:Keywords', 'image'), 'list');
  assert.equal(typeOfTag('PDF:CreateDate', 'pdf'), 'datetime');
  assert.equal(typeOfTag('XMP-bme:Anything', 'pdf'), 'text');
});

test('normalise makes written and read-back values comparable', () => {
  assert.equal(normalise(['a', 'b'], 'list'), 'a; b');
  assert.equal(normalise('a, b;c', 'list'), 'a; b; c');
  assert.equal(normalise('2026:10:28 00:00:00', 'date'), '2026-10-28');
  assert.equal(normalise('2026-10-28T09:30:00Z', 'datetime'), '2026-10-28T09:30');
  assert.equal(normalise('2026:10:28 09:30:00+01:00', 'datetime'), '2026-10-28T09:30');
  assert.equal(normalise(2026, 'text'), '2026');
  assert.equal(normalise(['Only'], 'text'), 'Only');
  assert.equal(normalise('  x \n', 'text'), 'x');
  assert.equal(normalise('True', 'bool'), 'true');
  assert.equal(normalise('4', 'rating'), '4');
  assert.equal(normalise('(Binary data 12 bytes, use -b option to extract)', 'image'), 'present');
  assert.equal(normalise(undefined, 'text'), '');
});

test('toExif converts form values to what ExifTool expects', () => {
  assert.deepEqual(toExif('a; b', 'list'), ['a', 'b']);
  assert.deepEqual(toExif(['a', 'b'], 'list'), ['a', 'b']);
  assert.equal(toExif('2026-10-28', 'date'), '2026:10:28 00:00:00');
  assert.equal(toExif('2026-10-28T09:30', 'datetime'), '2026:10:28 09:30:00');
  assert.equal(toExif(true, 'bool'), 'True');
  assert.equal(toExif('3', 'rating'), 3);
  assert.equal(toExif(null, 'text'), null);
});
