// The batch engine: which files may join the batch, what each file gets, and
// the write -> read back -> compare loop that decides each row's tick or cross.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { familyOf, isLegacyOffice } = require('./formats');
const { FIELDS, FAMILY_TABS, typeOfTag } = require('./fields');
const { normalise } = require('./values');
const { openWriters, EXIFTOOL_FAMILIES } = require('./writers');
const { supports } = require('./writers/exiftool');

const MAX_FILES = 20;
const CUSTOM_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const REASONS = {
  full: `Batch is full (${MAX_FILES} files max)`,
  unsupported: 'Unsupported file type',
  legacy: 'Old Office format: save as .docx/.xlsx/.pptx first',
  duplicate: 'Already in the batch',
};

const win = process.platform === 'win32';
const samePath = (a, b) => {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return win ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
};
// File names compare case-insensitively: Windows and macOS file systems do,
// and two outputs differing only in case would replace each other there.
const nameKey = (n) => n.toLowerCase();

// ---- Which files may join -------------------------------------------------

function validateBatch(paths, current = []) {
  const accepted = [];
  const refused = [];
  const inBatch = [...current];
  for (const p of paths) {
    let reason = null;
    if (isLegacyOffice(p)) reason = REASONS.legacy;
    else if (!familyOf(p)) reason = REASONS.unsupported;
    else if (inBatch.some((q) => samePath(p, q))) reason = REASONS.duplicate;
    else if (inBatch.length >= MAX_FILES) reason = REASONS.full;
    if (reason) refused.push({ path: p, reason });
    else {
      accepted.push(p);
      inBatch.push(p);
    }
  }
  return { accepted, refused };
}

// ---- What each file gets ----------------------------------------------------

function isBlank(value) {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return value.lat === '' || value.lat === undefined || value.lat === null;
  return false;
}

function customTags(name, family) {
  if (!CUSTOM_NAME.test(name)) throw new Error(`Invalid custom field name: ${JSON.stringify(name)}`);
  return {
    pdf: [`PDF:${name}`, `XMP-bme:${name}`],
    image: [`XMP-bme:${name}`],
    media: [`XMP-bme:${name}`],
    office: [`custom:${name}`],
    mp3: [`TXXX:${name}`],
  }[family] || [];
}

// {tag: {value, source}}, where source is the field id (or custom:<name>)
// that put it there. Later layers overwrite earlier ones: common, then the
// format tab, then custom fields, then the per-file title.
function resolveDetailed(form, family, perFileTitle) {
  const out = {};
  const fields = form.fields || {};
  const layer = (f) => {
    const entry = fields[f.id];
    if (!entry) return;
    const value = entry.clear ? null : entry.value;
    if (!entry.clear && isBlank(value)) return;
    for (const tag of f.targets[family] || []) out[tag] = { value, source: f.id };
  };
  FIELDS.filter((f) => f.tab === 'common').forEach(layer);
  FIELDS.filter((f) => f.tab === FAMILY_TABS[family]).forEach(layer);
  for (const c of form.custom || []) {
    if (!c.clear && isBlank(c.value)) {
      customTags(c.name, family); // still validate the name
      continue;
    }
    for (const tag of customTags(c.name, family)) out[tag] = { value: c.clear ? null : c.value, source: `custom:${c.name}` };
  }
  if (!isBlank(perFileTitle)) {
    for (const tag of FIELDS.find((f) => f.id === 'title').targets[family] || []) {
      out[tag] = { value: perFileTitle, source: 'title' };
    }
  }
  return out;
}

function resolveValues(form, family, perFileTitle) {
  const detailed = resolveDetailed(form, family, perFileTitle);
  return Object.fromEntries(Object.entries(detailed).map(([tag, d]) => [tag, d.value]));
}

// ---- Where each file goes -------------------------------------------------

function numbered(name, n, label) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  return `${stem} (${label}${label && n > 1 ? ' ' : ''}${label && n === 1 ? '' : n})${ext}`;
}

// Map each source to a destination in outDir. Duplicate names inside the
// batch become "name (2).ext"; names already in outDir are conflicts for the
// caller to resolve.
function outputPaths(paths, outDir, existing) {
  const taken = new Set();
  const dests = new Map();
  const conflicts = [];
  for (const p of paths) {
    const base = path.basename(p);
    let name = base;
    for (let n = 2; taken.has(nameKey(name)); n++) name = numbered(base, n, '');
    taken.add(nameKey(name));
    const dest = path.join(outDir, name);
    dests.set(p, dest);
    if (existing.has(nameKey(name))) conflicts.push(dest);
  }
  return { dests, conflicts };
}

// "a.pdf" -> "a (edited).pdf", then "a (edited 2).pdf", ... whichever is free.
function editedName(dest, existing, taken) {
  const base = path.basename(dest);
  for (let n = 1; ; n++) {
    const name = numbered(base, n, 'edited');
    if (!existing.has(nameKey(name)) && !taken.has(nameKey(name))) return path.join(path.dirname(dest), name);
  }
}

// ---- The run ----------------------------------------------------------------

function labelOf(source) {
  if (source.startsWith('custom:')) return source.slice(7);
  const f = FIELDS.find((x) => x.id === source);
  return f ? f.label : source;
}

function compare(intended, read, family) {
  const bad = [];
  for (const [tag, { value, source }] of Object.entries(intended)) {
    const type = typeOfTag(tag, family);
    const got = normalise(read[tag], type);
    const ok = value === null ? got === '' : normalise(value, type) === got;
    if (!ok) bad.push({ tag, source });
  }
  return bad;
}

async function runBatch({ files, form, outDir, strip = false, onConflict = 'suffix' }, onProgress = () => {}) {
  if (files.some((f) => samePath(path.dirname(f.path), outDir))) {
    throw new Error('Output folder is a source folder: choose another, so no original can be replaced');
  }
  const existing = new Set(fs.readdirSync(outDir).map(nameKey));
  const { dests } = outputPaths(files.map((f) => f.path), outDir, existing);
  const taken = new Set([...dests.values()].map((d) => nameKey(path.basename(d))));
  if (onConflict === 'suffix') {
    for (const [src, dest] of dests) {
      if (existing.has(nameKey(path.basename(dest)))) {
        const renamed = editedName(dest, existing, taken);
        taken.add(nameKey(path.basename(renamed)));
        dests.set(src, renamed);
      }
    }
  }

  const customNames = (form.custom || []).map((c) => c.name).filter((n) => CUSTOM_NAME.test(n));
  const writers = openWriters({ customNames });
  const results = [];
  try {
    for (const [index, file] of files.entries()) {
      onProgress({ index, path: file.path, status: 'working' });
      const dest = dests.get(file.path);
      const family = familyOf(file.path);
      const ext = path.extname(file.path).toLowerCase();
      // Written beside the final name, then renamed over it: an existing
      // file is only replaced once the new one is complete.
      const tmp = path.join(outDir, `.${crypto.randomUUID().slice(0, 8)}.bme-tmp${ext}`);
      const result = { path: file.path, dest, ok: false };
      try {
        const intended = resolveDetailed(form, family, file.title);
        const skipped = new Set();
        if (EXIFTOOL_FAMILIES.has(family)) {
          for (const [tag, d] of Object.entries(intended)) {
            if (!supports(ext, tag)) {
              skipped.add(d.source);
              delete intended[tag];
            }
          }
          // A field skipped for one tag but written to another is not skipped.
          for (const d of Object.values(intended)) skipped.delete(d.source);
        }
        const writer = writers.forFamily(family);
        const tags = Object.fromEntries(Object.entries(intended).map(([t, d]) => [t, d.value]));
        const { warnings = [] } = (await writer.write(file.path, tmp, tags, { strip })) || {};
        const bad = compare(intended, await writer.read(tmp), family);
        fs.renameSync(tmp, dest);
        result.skipped = [...skipped];
        if (bad.length) {
          result.mismatched = [...new Set(bad.map((b) => b.source))];
          const fields = result.mismatched.map(labelOf).join(', ');
          result.error = `Not saved as entered: ${fields} (${bad.map((b) => b.tag).join(', ')})`
            + (warnings.length ? `. ${warnings.join('; ')}` : '');
        } else {
          result.ok = true;
        }
      } catch (e) {
        result.error = String(e.message || e).replace(/\s+/g, ' ').trim();
      } finally {
        fs.rmSync(tmp, { force: true });
      }
      results.push(result);
      onProgress({ index, path: file.path, status: 'done', result });
    }
  } finally {
    await writers.end();
  }
  return results;
}

module.exports = { validateBatch, resolveValues, outputPaths, runBatch, MAX_FILES, REASONS, CUSTOM_NAME };
