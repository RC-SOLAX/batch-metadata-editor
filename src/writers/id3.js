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

// Apply one form tag to a node-id3 tag object.
function apply(tags, tag, value) {
  if (tag.startsWith('TXXX:')) {
    const description = tag.slice(5);
    const list = (tags.userDefinedText || []).filter((t) => t.description !== description);
    if (value !== null) list.push({ description, value: toText(value) });
    tags.userDefinedText = list;
    return;
  }
  if (value === null) {
    delete tags[tag === 'rating' ? 'popularimeter' : tag];
    return;
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
    tags[tag] = toText(value);
  }
}

async function write(src, dest, tags, { strip = false } = {}) {
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  try {
    const merged = strip ? {} : readTags(dest);
    for (const [tag, value] of Object.entries(tags)) apply(merged, tag, value);
    if (merged.userDefinedText && !merged.userDefinedText.length) delete merged.userDefinedText;
    const res = NodeID3.write(merged, dest);
    if (res instanceof Error) throw res;
    if (res !== true) throw new Error(`Could not write ID3 tags to ${path.basename(dest)}`);
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e;
  }
  return { warnings: [] };
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
