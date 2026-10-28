// ExifTool writer for the pdf, image and media families.
//
// Sources are never opened for writing: write() copies src -> dest (refusing
// to replace an existing dest) and edits only dest.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ExifTool } = require('exiftool-vendored');
const { typeOfTag } = require('../fields');
const { familyOf } = require('../formats');
const { toExif } = require('../values');

const XMP_NS = 'http://ns.batchmetadataeditor/1.0/';
const IPTC_EXTS = ['.jpg', '.jpeg', '.tif', '.tiff'];
const READ_ARGS = ['-G1', '-a'];

// Tags ExifTool stores as true lists. A list value bound for any other tag is
// joined into one string first; ExifTool would otherwise join it with \x1f.
const LIST_TAGS = new Set([
  'XMP-dc:Subject', 'XMP-dc:Creator', 'XMP-dc:Contributor',
  'IPTC:Keywords', 'IPTC:SupplementalCategories',
]);

// Whether ExifTool can write this tag into a file with this extension.
// IPTC-IIM only lives in JPEG and TIFF; everything else the catalogue maps
// to a family is writable for every extension in that family.
function supports(ext, tag) {
  const group = tag.split(':')[0];
  if (group === 'IPTC') return IPTC_EXTS.includes(ext.toLowerCase());
  return true;
}

// A config that defines each custom name as a PDF Info key and as a tag in
// our own XMP namespace (XMP-bme). ExifTool rejects undefined tags otherwise.
function customConfig(names) {
  const defs = names.map((n) => `    ${n} => { },`).join('\n');
  return `%Image::ExifTool::UserDefined = (
  'Image::ExifTool::PDF::Info' => {
${defs}
  },
  'Image::ExifTool::XMP::Main' => {
    bme => { SubDirectory => { TagTable => 'Image::ExifTool::UserDefined::bme' } },
  },
);
%Image::ExifTool::UserDefined::bme = (
  GROUPS => { 0 => 'XMP', 1 => 'XMP-bme', 2 => 'Other' },
  NAMESPACE => { 'bme' => '${XMP_NS}' },
  WRITABLE => 'string',
${defs}
);
1;
`;
}

// Form values -> ExifTool tags + extra command-line args, for one file.
function toExifTool(tags, family) {
  const out = {};
  const args = [];
  for (const [tag, value] of Object.entries(tags)) {
    if (tag === 'EXIF:GPS') {
      if (value === null) {
        for (const t of ['GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef']) {
          out[`GPS:${t}`] = null;
        }
        continue;
      }
      const lat = Number(value.lat);
      const lon = Number(value.lon);
      out['GPS:GPSLatitude'] = Math.abs(lat);
      out['GPS:GPSLatitudeRef'] = lat < 0 ? 'S' : 'N';
      out['GPS:GPSLongitude'] = Math.abs(lon);
      out['GPS:GPSLongitudeRef'] = lon < 0 ? 'W' : 'E';
      if (value.alt !== undefined && value.alt !== null && value.alt !== '') {
        const alt = Number(value.alt);
        out['GPS:GPSAltitude'] = Math.abs(alt);
        out['GPS:GPSAltitudeRef'] = alt < 0 ? 1 : 0;
      }
      continue;
    }
    if (tag.endsWith('@file')) {
      const real = tag.slice(0, -'@file'.length);
      if (value === null) out[real] = null;
      else args.push(`-${real}<=${value}`);
      continue;
    }
    const v = toExif(value, typeOfTag(tag, family));
    out[tag] = Array.isArray(v) && !LIST_TAGS.has(tag) ? v.join(tag === 'PDF:Keywords' ? ', ' : '; ') : v;
  }
  return { out, args };
}

// Read back in the same shape write() takes: group-qualified tags, plus
// EXIF:GPS as {lat, lon, alt} and <tag>@file aliases for binaries.
async function readWith(et, file) {
  const raw = await et.readRaw(file, READ_ARGS);
  const result = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'SourceFile' || k === 'errors' || k === 'warnings') continue;
    result[k] = v;
    result[`${k}@file`] = v;
  }
  if ('GPS:GPSLatitude' in raw) {
    const n = await et.readRaw(file, ['-G1', '-a', '-n', '-GPS:all']);
    const sign = (ref, neg) => (ref === neg ? -1 : 1);
    result['EXIF:GPS'] = {
      lat: Number(n['GPS:GPSLatitude']) * sign(n['GPS:GPSLatitudeRef'], 'S'),
      lon: Number(n['GPS:GPSLongitude']) * sign(n['GPS:GPSLongitudeRef'], 'W'),
      alt: 'GPS:GPSAltitude' in n ? Number(n['GPS:GPSAltitude']) * (Number(n['GPS:GPSAltitudeRef']) === 1 ? -1 : 1) : undefined,
    };
  }
  return result;
}

function openSession({ customNames = [] } = {}) {
  const cfgPath = path.join(os.tmpdir(), `bme-${crypto.randomUUID()}.config`);
  fs.writeFileSync(cfgPath, customConfig(customNames));
  const et = new ExifTool({
    maxProcs: 1,
    exiftoolArgs: ['-config', cfgPath, '-stay_open', 'True', '-@', '-'],
  });

  return {
    async write(src, dest, tags, { strip = false } = {}) {
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
      const ext = path.extname(dest).toLowerCase();
      const { out, args } = toExifTool(tags, familyOf(dest));
      if (strip) await et.deleteAllTags(dest);
      const writeArgs = ['-overwrite_original', ...args];
      if (IPTC_EXTS.includes(ext) && Object.keys(out).some((t) => t.startsWith('IPTC:'))) {
        writeArgs.push('-charset', 'iptc=UTF8', '-IPTC:CodedCharacterSet=UTF8');
      }
      if (!Object.keys(out).length && !args.length) return { warnings: [] };
      const res = await et.write(dest, out, { writeArgs });
      return { warnings: (res.warnings || []).filter((w) => !/Nothing to do/.test(w)) };
    },
    read: (file) => readWith(et, file),
    async end() {
      await et.end();
      fs.rmSync(cfgPath, { force: true });
    },
  };
}

// Shared reader for the "current metadata" panel; no custom config needed.
let shared = null;
function readCurrent(file) {
  shared = shared || new ExifTool({ maxProcs: 1 });
  return readWith(shared, file);
}
async function endShared() {
  if (shared) await shared.end();
  shared = null;
}

module.exports = { openSession, readCurrent, endShared, supports, customConfig };
