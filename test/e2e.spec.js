// Drives the real app: add files, fill the form, Apply, then check the
// copies with independent readers.
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fixture, tmpDir, sha256, readRaw, rawEt } = require('./helpers/common');

const PY = process.platform === 'win32' ? 'python' : 'python3';
const readOffice = (file) =>
  JSON.parse(execFileSync(PY, [path.join(__dirname, 'helpers', 'read_office.py'), file], { encoding: 'utf8' }));

test.afterAll(() => rawEt.end());

async function launch(outDir) {
  const args = ['.'];
  if (process.platform === 'linux' && process.getuid && process.getuid() === 0) args.push('--no-sandbox');
  const app = await electron.launch({
    executablePath: require('electron'),
    args,
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, BME_TEST_OUTDIR: outDir },
  });
  const win = await app.firstWindow();
  await win.waitForSelector('#tab-common');
  return { app, win };
}

test('drop four files, fill the form, apply: every copy carries the values', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const names = ['a.pdf', 'a.docx', 'a.jpg', 'a.mp3'];
  const paths = names.map((n) => {
    const p = path.join(src, n);
    fs.copyFileSync(fixture(n), p);
    return p;
  });
  const before = paths.map(sha256);

  const { app, win } = await launch(out);
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  try {
    await win.setInputFiles('#file-input', paths);
    await expect(win.locator('#count')).toHaveText('4 / 20');
    await win.fill('#f-title', 'E2E Title');
    await win.fill('#f-author', 'E2E Author');
    await win.locator('.file-title').nth(2).fill('Photo title');
    await win.click('#apply');
    await expect(win.locator('.file.ok')).toHaveCount(4, { timeout: 60_000 });
    await expect(win.locator('#notice')).toContainText('4 of 4 files saved');
  } finally {
    await app.close();
  }
  expect(errors).toEqual([]);

  expect((await readRaw(path.join(out, 'a.pdf')))['PDF:Title']).toBe('E2E Title');
  expect((await readRaw(path.join(out, 'a.pdf')))['PDF:Author']).toBe('E2E Author');
  expect((await readRaw(path.join(out, 'a.jpg')))['XMP-dc:Title']).toBe('Photo title');
  expect((await readRaw(path.join(out, 'a.mp3')))['ID3v2_3:Title']).toBe('E2E Title');
  expect(readOffice(path.join(out, 'a.docx'))['core:title']).toBe('E2E Title');
  expect(paths.map(sha256)).toEqual(before);
});

test('more than 20 files: the extras are refused with a count', async () => {
  const src = tmpDir();
  const paths = Array.from({ length: 22 }, (_, i) => {
    const p = path.join(src, `f${i}.pdf`);
    fs.copyFileSync(fixture('a.pdf'), p);
    return p;
  });
  const { app, win } = await launch(tmpDir());
  try {
    await win.setInputFiles('#file-input', paths);
    await expect(win.locator('#count')).toHaveText('20 / 20');
    await expect(win.locator('#notice')).toContainText('2 files not added: 2 × Batch is full (20 files max)');
  } finally {
    await app.close();
  }
});

test('an existing output prompts, and "(edited)" keeps the old file', async () => {
  const src = tmpDir();
  const out = tmpDir();
  const p = path.join(src, 'a.pdf');
  fs.copyFileSync(fixture('a.pdf'), p);
  fs.writeFileSync(path.join(out, 'a.pdf'), 'old');
  const { app, win } = await launch(out);
  try {
    await win.setInputFiles('#file-input', [p]);
    await win.fill('#f-title', 'T');
    await win.click('#apply');
    await expect(win.locator('#dialog-title')).toHaveText('1 file already in that folder');
    await win.click('#dialog-actions button[value="suffix"]');
    await expect(win.locator('.file.ok')).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await app.close();
  }
  expect(fs.readFileSync(path.join(out, 'a.pdf'), 'utf8')).toBe('old');
  expect((await readRaw(path.join(out, 'a (edited).pdf')))['PDF:Title']).toBe('T');
});
