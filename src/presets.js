// Named sets of form values, stored as <name>.json in one folder.

const fs = require('node:fs/promises');
const path = require('node:path');

function cleanName(name) {
  const clean = String(name).replace(/[^\w -]/g, '').trim().slice(0, 60);
  if (!clean) throw new Error('A preset needs a name (letters, digits, spaces, - or _)');
  return clean;
}

function createPresets(dir) {
  const file = (name) => path.join(dir, `${cleanName(name)}.json`);
  return {
    async list() {
      await fs.mkdir(dir, { recursive: true });
      return (await fs.readdir(dir))
        .filter((n) => n.endsWith('.json'))
        .map((n) => n.slice(0, -5))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    },
    async save(name, form) {
      const target = file(name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(target, JSON.stringify(form, null, 2));
      return path.basename(target, '.json');
    },
    async load(name) {
      return JSON.parse(await fs.readFile(file(name), 'utf8'));
    },
    async remove(name) {
      await fs.rm(file(name), { force: true });
    },
  };
}

module.exports = { createPresets, cleanName };
