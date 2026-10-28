// Shared test helpers: temp dirs, hashes, sample values, a raw ExifTool reader.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ExifTool } = require('exiftool-vendored');

const FIX = path.join(__dirname, '..', 'fixtures');
const fixture = (name) => path.join(FIX, name);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bme test '));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Values some tags constrain; everything else gets SAMPLE[type].
const SAMPLE_BY_TAG = {
  'IPTC:Category': 'ABC',
  'IPTC:Country-PrimaryLocationCode': 'GBR',
  'XMP-iptcCore:CountryCode': 'GB',
  'ItemList:Year': '2026',
  'ItemList:TrackNumber': '3 of 9',
  'ItemList:DiskNumber': '1 of 2',
  year: '2026',
  date: '2810',
  trackNumber: '3/9',
  partOfSet: '1/2',
  language: 'eng',
  ISRC: 'GBAAA2600001',
  artistUrl: 'https://example.com/artist',
};

const SAMPLE = {
  text: 'Sample é ✓',
  multiline: 'Line one\nLine two é',
  list: ['alpha', 'beta é'],
  date: '2026-10-28',
  datetime: '2026-10-28T09:30',
  number: '7',
  rating: '4',
  bool: true,
  image: fixture('a.jpg'),
  gps: { lat: 53.74, lon: -0.33, alt: 12 },
};

function sampleFor(field, tag) {
  if (tag in SAMPLE_BY_TAG) return SAMPLE_BY_TAG[tag];
  if (field.type === 'choice') return field.options[0];
  return SAMPLE[field.type];
}

// An independent reader: ExifTool with group-qualified, duplicate-preserving output.
const rawEt = new ExifTool({ maxProcs: 1 });
async function readRaw(file) {
  return rawEt.readRaw(file, ['-G1', '-a']);
}

module.exports = { fixture, tmpDir, sha256, sampleFor, SAMPLE, readRaw, rawEt };
