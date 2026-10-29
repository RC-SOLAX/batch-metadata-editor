// MP3 writer (ID3v2.3 via node-id3).
//
// Tags use node-id3's keys (title, trackNumber, ...), plus:
//   TXXX:<name>  a user-defined text frame
//   rating       0–5 stars, stored as a Windows-style popularimeter
//   image        a path to the cover-art image file

const fs = require('node:fs');
const path = require('node:path');
const NodeID3 = require('node-id3');
const { splitList } = require('../values');

const RATING_EMAIL = 'Windows Media Player 9 Series';
const STARS_TO_BYTE = [0, 1, 64, 128, 196, 255];
const LANG_FRAMES = new Set(['comment', 'unsynchronisedLyrics']);
// Frames whose text ID3v2.3 readers expect in a fixed form. A value in any
// other form is not written; the read-back check then reports the field.
const FORMATS = {
  year: [/^\d{4}$/, 'a 4-digit year'],
  date: [/^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])$/, 'DDMM'],
  trackNumber: [/^\d{1,4}(\/\d{1,4})?$/, 'a number, or number/total'],
  partOfSet: [/^\d{1,4}(\/\d{1,4})?$/, 'a number, or number/total'],
  bpm: [/^\d{1,4}$/, 'a whole number'],
};

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };

function byteToStars(b) {
  const n = Number(b);
  if (!n) return 0;
  if (n < 32) return 1;
  if (n < 96) return 2;
  if (n < 160) return 3;
  if (n < 224) return 4;
  return 5;
}

const toText = (v) => (Array.isArray(v) ? splitList(v).join('; ') : String(v));

function readTags(file) {
  const tags = NodeID3.read(file, { noRaw: true });
  if (tags instanceof Error) throw tags;
  return tags || {};
}

// ID3v2.4 files (Picard, foobar2000) keep the date in TDRC, which ID3v2.3
// does not have; carry it into the v2.3 year/date frames instead.
function downgradeV24(tags) {
  const rt = tags.recordingTime;
  if (rt) {
    const m = String(rt).match(/^(\d{4})(?:-(\d{2})-(\d{2}))?/);
    if (m && !tags.year) tags.year = m[1];
    if (m && m[2] && !tags.date) tags.date = `${m[3]}${m[2]}`;
    delete tags.recordingTime;
  }
  const ot = tags.originalReleaseTime;
  if (ot) {
    const m = String(ot).match(/^(\d{4})/);
    if (m && !tags.originalYear) tags.originalYear = m[1];
    delete tags.originalReleaseTime;
  }
  delete tags.releaseTime;
  delete tags.encodingTime;
  delete tags.taggingTime;
}

// Apply one form tag to a node-id3 tag object. Returns a warning, or null.
function apply(tags, tag, value) {
  if (value !== null && FORMATS[tag] && !FORMATS[tag][0].test(String(value).trim())) {
    return `${tag} "${value}" was not written: ID3 needs ${FORMATS[tag][1]}`;
  }
  if (tag.startsWith('TXXX:')) {
    const description = tag.slice(5);
    const list = (tags.userDefinedText || []).filter((t) => t.description !== description);
    if (value !== null) list.push({ description, value: toText(value) });
    tags.userDefinedText = list;
    return null;
  }
  if (value === null) {
    delete tags[tag === 'rating' ? 'popularimeter' : tag];
    return null;
  }
  if (LANG_FRAMES.has(tag)) {
    tags[tag] = { language: 'eng', text: toText(value) };
  } else if (tag === 'artistUrl') {
    tags.artistUrl = [String(value)];
  } else if (tag === 'rating') {
    const stars = Math.max(0, Math.min(5, Math.round(Number(value))));
    tags.popularimeter = { email: RATING_EMAIL, rating: STARS_TO_BYTE[stars], counter: 0 };
  } else if (tag === 'image') {
    const ext = path.extname(String(value)).toLowerCase();
    if (!MIME[ext]) throw new Error(`Cover art must be a JPG, PNG, GIF or WebP image: ${path.basename(String(value))}`);
    tags.image = { mime: MIME[ext], type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: fs.readFileSync(value) };
  } else {
    tags[tag] = String(toText(value)).trim();
  }
  return null;
}

// From a node-id3 tag object, only the frames behind the given form tags.
function pick(existing, keep) {
  const out = {};
  for (const tag of keep) {
    if (tag.startsWith('TXXX:')) {
      const hit = (existing.userDefinedText || []).filter((t) => t.description === tag.slice(5));
      if (hit.length) out.userDefinedText = [...(out.userDefinedText || []), ...hit];
    } else {
      const key = tag === 'rating' ? 'popularimeter' : tag;
      if (existing[key] !== undefined) out[key] = existing[key];
    }
  }
  return out;
}

async function write(src, dest, tags, { strip = false, keep = [] } = {}) {
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  const warnings = [];
  try {
    const existing = readTags(dest);
    downgradeV24(existing);
    const merged = strip ? pick(existing, keep) : existing;
    for (const [tag, value] of Object.entries(tags)) {
      const w = apply(merged, tag, value);
      if (w) warnings.push(w);
    }
    if (merged.userDefinedText && !merged.userDefinedText.length) delete merged.userDefinedText;
    const res = NodeID3.write(merged, dest);
    if (res instanceof Error) throw res;
    if (res !== true) throw new Error(`Could not write ID3 tags to ${path.basename(dest)}`);
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e;
  }
  return { warnings };
}

// Read back in the shape write() takes.
async function read(file) {
  const t = readTags(file);
  const out = {};
  for (const [key, value] of Object.entries(t)) {
    if (key === 'userDefinedText') {
      for (const u of [].concat(value)) out[`TXXX:${u.description}`] = u.value;
    } else if (LANG_FRAMES.has(key)) {
      out[key] = value && value.text;
    } else if (key === 'artistUrl') {
      out.artistUrl = [].concat(value)[0];
    } else if (key === 'popularimeter') {
      out.rating = String(byteToStars([].concat(value)[0].rating));
    } else if (key === 'image') {
      out.image = value && value.imageBuffer ? 'present' : undefined;
    } else if (typeof value === 'string') {
      out[key] = value;
    }
  }
  return out;
}

module.exports = { write, read };
