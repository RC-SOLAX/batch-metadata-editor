const path = require('node:path');

// Extension -> format family. This is the one list of what the app accepts.
const FAMILIES = {
  pdf: ['.pdf'],
  office: ['.docx', '.docm', '.dotx', '.xlsx', '.xlsm', '.xltx', '.pptx', '.pptm', '.potx'],
  image: ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic'],
  mp3: ['.mp3'],
  media: ['.mp4', '.m4a', '.m4v', '.mov'],
};

const LEGACY_OFFICE = ['.doc', '.xls', '.ppt'];

const BY_EXT = new Map();
for (const [family, exts] of Object.entries(FAMILIES)) {
  for (const ext of exts) BY_EXT.set(ext, family);
}

const ACCEPTED = [...BY_EXT.keys()];

function ext(filePath) {
  return path.extname(filePath.replace(/\\/g, '/')).toLowerCase();
}

function familyOf(filePath) {
  return BY_EXT.get(ext(filePath)) || null;
}

function isLegacyOffice(filePath) {
  return LEGACY_OFFICE.includes(ext(filePath));
}

module.exports = { familyOf, isLegacyOffice, ACCEPTED, FAMILIES };
