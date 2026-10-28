const { test } = require('node:test');
const assert = require('node:assert/strict');
const { familyOf, isLegacyOffice, ACCEPTED } = require('../src/formats');

test('familyOf maps extensions to families, case-insensitively', () => {
  assert.equal(familyOf('C:\\x\\A.PDF'), 'pdf');
  assert.equal(familyOf('a.JPEG'), 'image');
  assert.equal(familyOf('a.heic'), 'image');
  assert.equal(familyOf('a.m4a'), 'media');
  assert.equal(familyOf('a.mov'), 'media');
  assert.equal(familyOf('a.xlsm'), 'office');
  assert.equal(familyOf('a.potx'), 'office');
  assert.equal(familyOf('a.mp3'), 'mp3');
});

test('familyOf refuses unknown and legacy Office types', () => {
  assert.equal(familyOf('a.txt'), null);
  assert.equal(familyOf('noext'), null);
  assert.equal(familyOf('a.doc'), null);
});

test('isLegacyOffice flags .doc/.xls/.ppt only', () => {
  assert.equal(isLegacyOffice('a.doc'), true);
  assert.equal(isLegacyOffice('B.XLS'), true);
  assert.equal(isLegacyOffice('a.ppt'), true);
  assert.equal(isLegacyOffice('a.docx'), false);
});

test('ACCEPTED lists every supported extension with a dot', () => {
  assert.ok(ACCEPTED.includes('.pdf'));
  assert.ok(ACCEPTED.includes('.webp'));
  assert.equal(ACCEPTED.length, 22);
});
