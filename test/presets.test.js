const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPresets } = require('../src/presets');
const { tmpDir } = require('./helpers/common');

const FORM = { fields: { title: { value: 'T', clear: false } }, custom: [{ name: 'Ref', value: '1', clear: false }] };

test('save, list, load and remove a preset', async () => {
  const p = createPresets(tmpDir());
  await p.save('Product images', FORM);
  assert.deepEqual(await p.list(), ['Product images']);
  assert.deepEqual(await p.load('Product images'), FORM);
  await p.remove('Product images');
  assert.deepEqual(await p.list(), []);
});

test('a preset name cannot escape the presets folder', async () => {
  const dir = tmpDir();
  const p = createPresets(dir);
  await p.save('../evil', FORM);
  assert.ok(fs.existsSync(path.join(dir, 'evil.json')));
  assert.deepEqual(await p.list(), ['evil']);
});

test('an empty name is refused', async () => {
  const p = createPresets(tmpDir());
  await assert.rejects(p.save('../', FORM), /name/i);
});

test('list is sorted and ignores other files', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const p = createPresets(dir);
  await p.save('b', FORM);
  await p.save('A', FORM);
  assert.deepEqual(await p.list(), ['A', 'b']);
});

test('the folder is created if missing', async () => {
  const dir = path.join(tmpDir(), 'sub', 'presets');
  const p = createPresets(dir);
  assert.deepEqual(await p.list(), []);
  await p.save('x', FORM);
  assert.ok(fs.existsSync(path.join(dir, 'x.json')));
});
