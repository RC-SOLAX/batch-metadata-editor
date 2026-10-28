const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const id3 = require('../src/writers/id3');
const { FIELDS, typeOfTag } = require('../src/fields');
const { normalise } = require('../src/values');
const { fixture, tmpDir, sha256, sampleFor, readRaw, rawEt } = require('./helpers/common');

after(() => rawEt.end());

// node-id3 key -> the name ExifTool reads it under (group ID3v2_3).
const EXIF_NAME = {
  title: 'Title', artist: 'Artist', album: 'Album', performerInfo: 'Band', composer: 'Composer',
  conductor: 'Conductor', genre: 'Genre', year: 'Year', date: 'Date', trackNumber: 'Track',
  partOfSet: 'PartOfSet', bpm: 'BeatsPerMinute', initialKey: 'InitialKey', language: 'Language',
  publisher: 'Publisher', copyright: 'Copyright', encodedBy: 'EncodedBy', ISRC: 'ISRC',
  comment: 'Comment', unsynchronisedLyrics: 'Lyrics', originalArtist: 'OriginalArtist',
  subtitle: 'Subtitle', contentGroup: 'Grouping', artistUrl: 'ArtistURL',
};

function allMp3Tags() {
  const tags = {};
  for (const f of FIELDS) {
    for (const tag of f.targets.mp3 || []) if (!(tag in tags)) tags[tag] = sampleFor(f, tag);
  }
  tags['TXXX:Batch_Ref'] = 'R-1';
  return tags;
}

test('every mp3 tag round-trips; ExifTool independently agrees', async () => {
  const src = fixture('a.mp3');
  const before = sha256(src);
  const dest = path.join(tmpDir(), 'a.mp3');
  const tags = allMp3Tags();
  await id3.write(src, dest, tags, { strip: false });

  const mine = await id3.read(dest);
  const bad = [];
  for (const [tag, want] of Object.entries(tags)) {
    const type = typeOfTag(tag, 'mp3');
    if (normalise(want, type) !== normalise(mine[tag], type)) bad.push(`${tag}: read ${JSON.stringify(mine[tag])}`);
  }
  assert.deepEqual(bad, []);

  const raw = await readRaw(dest);
  const badRaw = [];
  for (const [key, name] of Object.entries(EXIF_NAME)) {
    const type = typeOfTag(key, 'mp3');
    if (normalise(tags[key], type) !== normalise(raw[`ID3v2_3:${name}`], type)) {
      badRaw.push(`${key} -> ID3v2_3:${name}: ${JSON.stringify(raw[`ID3v2_3:${name}`])}`);
    }
  }
  assert.deepEqual(badRaw, []);
  assert.equal(raw['ID3v2_3:Batch_Ref'], 'R-1');
  assert.equal(raw['ID3v2_3:Keywords'], 'alpha; beta é');
  assert.match(String(raw['ID3v2_3:Popularimeter']), /Rating=196 /); // 4 stars, as Windows writes it
  assert.ok(raw['ID3v2_3:Picture'], 'cover art present');
  assert.equal(sha256(src), before);
});

test('a null value clears the frame and keeps the rest', async () => {
  const dir = tmpDir();
  const one = path.join(dir, 'one.mp3');
  const two = path.join(dir, 'two.mp3');
  await id3.write(fixture('a.mp3'), one, { album: 'Gone', title: 'Stays', 'TXXX:A': '1', 'TXXX:B': '2' }, {});
  await id3.write(one, two, { album: null, 'TXXX:A': null }, {});
  const r = await id3.read(two);
  assert.equal(r.album, undefined);
  assert.equal(r.title, 'Stays');
  assert.equal(r['TXXX:A'], undefined);
  assert.equal(r['TXXX:B'], '2');
});

test('strip removes existing frames first', async () => {
  const dir = tmpDir();
  const one = path.join(dir, 'one.mp3');
  const two = path.join(dir, 'two.mp3');
  await id3.write(fixture('a.mp3'), one, { 'TXXX:Old': 'x', artist: 'Old' }, {});
  await id3.write(one, two, { title: 'New' }, { strip: true });
  const r = await id3.read(two);
  assert.equal(r['TXXX:Old'], undefined);
  assert.equal(r.artist, undefined);
  assert.equal(r.title, 'New');
});

test('rating maps 0–5 stars to the Windows popularimeter scale and back', async () => {
  for (const [stars, byte] of [[1, 1], [2, 64], [3, 128], [4, 196], [5, 255]]) {
    const dest = path.join(tmpDir(), 'a.mp3');
    await id3.write(fixture('a.mp3'), dest, { rating: String(stars) }, {});
    assert.match(String((await readRaw(dest))['ID3v2_3:Popularimeter']), new RegExp(`Rating=${byte} `));
    assert.equal((await id3.read(dest)).rating, String(stars));
  }
});

test('unicode round-trip', async () => {
  const text = 'Café — 東京 ✓';
  const dest = path.join(tmpDir(), 'a.mp3');
  await id3.write(fixture('a.mp3'), dest, { title: text, comment: text, 'TXXX:Note': text }, {});
  const raw = await readRaw(dest);
  assert.equal(raw['ID3v2_3:Title'], text);
  assert.equal(raw['ID3v2_3:Comment'], text);
  assert.equal(raw['ID3v2_3:Note'], text);
});

test('an existing destination is never overwritten', async () => {
  const dest = path.join(tmpDir(), 'a.mp3');
  fs.writeFileSync(dest, 'keep');
  await assert.rejects(id3.write(fixture('a.mp3'), dest, { title: 'x' }, {}), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'keep');
});
