// One shape for every writer: { write(src, dest, tags, opts), read(file) }.
// The ExifTool process is started on first use and shut down by end().

const exiftool = require('./exiftool');
const office = require('./office');
const id3 = require('./id3');

const EXIFTOOL_FAMILIES = new Set(['pdf', 'image', 'media']);

function openWriters({ customNames = [] } = {}) {
  let session = null;
  const et = () => (session = session || exiftool.openSession({ customNames }));
  return {
    forFamily(family) {
      if (EXIFTOOL_FAMILIES.has(family)) return { write: (...a) => et().write(...a), read: (f) => et().read(f) };
      if (family === 'office') return office;
      if (family === 'mp3') return id3;
      throw new Error(`No writer for ${family}`);
    },
    // Windows creation date of a finished file; ExifTool can set it, Node cannot.
    async setFileCreateDate(file, value) {
      await et().setFileCreateDate(file, value);
    },
    async end() {
      if (session) await session.end();
      session = null;
    },
  };
}

module.exports = { openWriters, EXIFTOOL_FAMILIES };
