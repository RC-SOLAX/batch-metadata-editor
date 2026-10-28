// Reading a file's existing metadata into the form's shape, so the form can
// start from what is already there.

const fs = require('node:fs');
const { FIELDS } = require('./fields');
const { familyOf } = require('./formats');
const { normalise, splitList } = require('./values');
const exiftool = require('./writers/exiftool');
const office = require('./writers/office');
const id3 = require('./writers/id3');

const CUSTOM_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const READERS = {
  pdf: exiftool.readCurrent,
  image: exiftool.readCurrent,
  media: exiftool.readCurrent,
  office: office.read,
  mp3: id3.read,
};

// Where each family keeps the custom name/value pairs the app writes.
const CUSTOM_PREFIX = { office: 'custom:', mp3: 'TXXX:', pdf: 'XMP-bme:', image: 'XMP-bme:', media: 'XMP-bme:' };
// TXXX frames the catalogue already owns.
const OWNED_TXXX = new Set(['Keywords']);

function readMetadata(file) {
  const read = READERS[familyOf(file)];
  if (!read) throw new Error('Unsupported file type');
  return read(file);
}

const isBlank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

const localStamp = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// One stored value -> what the field's input holds, or undefined if the
// value cannot be shown in that kind of input.
function toFormValue(raw, field) {
  if (isBlank(raw)) return undefined;
  switch (field.type) {
    case 'image':
      return undefined; // a stored picture has no path to show
    case 'gps':
      return raw && Number.isFinite(raw.lat) && Number.isFinite(raw.lon)
        ? { lat: String(raw.lat), lon: String(raw.lon), alt: Number.isFinite(raw.alt) ? String(raw.alt) : '' }
        : undefined;
    case 'number':
    case 'rating': {
      const n = Number(raw);
      if (!Number.isFinite(n) || String(raw).trim() === '') return undefined;
      if (field.type === 'rating' && (n < 0 || n > 5)) return undefined;
      return String(n);
    }
    case 'choice': {
      const hit = field.options.find((o) => o.toLowerCase() === String(raw).trim().toLowerCase());
      return hit;
    }
    case 'bool':
      return normalise(raw, 'bool');
    case 'date':
    case 'datetime': {
      const v = normalise(raw, field.type);
      return /^\d{4}-\d{2}-\d{2}/.test(v) ? v : undefined;
    }
    case 'list':
      return splitList(raw).join('; ');
    default: {
      const v = normalise(raw, 'text');
      return /^\(Binary data/.test(v) ? undefined : v;
    }
  }
}

// read: the reader's {tag: value} map; stat: fs.Stats of the file (or null).
function prefillFromFile(read, family, stat) {
  const fields = {};
  for (const f of FIELDS) {
    const tags = f.targets[family] || [];
    let value;
    for (const tag of tags) {
      if (tag === 'System:FileCreateDate') value = stat ? localStamp(stat.birthtime) : undefined;
      else if (tag === 'System:FileModifyDate') value = stat ? localStamp(stat.mtime) : undefined;
      else value = toFormValue(read[tag], f);
      if (value !== undefined) break;
    }
    if (value !== undefined) fields[f.id] = value;
  }
  const prefix = CUSTOM_PREFIX[family];
  const custom = [];
  for (const [tag, raw] of Object.entries(read)) {
    if (!tag.startsWith(prefix) || tag.endsWith('@file')) continue;
    const name = tag.slice(prefix.length);
    if (!CUSTOM_NAME.test(name) || (family === 'mp3' && OWNED_TXXX.has(name))) continue;
    // Office's own Copyright lives in custom properties and has a field.
    if (family === 'office' && name === 'Copyright') continue;
    const value = toFormValue(raw, { type: 'text' });
    if (value !== undefined) custom.push({ name, value });
  }
  return { fields, custom };
}

async function readForPrefill(file) {
  const read = await readMetadata(file);
  return prefillFromFile(read, familyOf(file), fs.statSync(file));
}

module.exports = { prefillFromFile, readForPrefill, readMetadata };
