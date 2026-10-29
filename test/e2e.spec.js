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
    await expect(win.locator('#notice')).toContainText('Filled in'); // details loaded
    await win.fill('#f-title', 'T');
    await win.click('#apply');
    await expect(win.locator('#dialog-title')).toContainText('Wipe');
    await win.click('#dialog-actions button[value="ok"]');
    await expect(win.locator('#dialog-title')).toHaveText('1 file already in that folder');
    await win.click('#dialog-actions button[value="suffix"]');
    await expect(win.locator('.file.ok')).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await app.close();
  }
  expect(fs.readFileSync(path.join(out, 'a.pdf'), 'utf8')).toBe('old');
  expect((await readRaw(path.join(out, 'a (edited).pdf')))['PDF:Title']).toBe('T');
});

test('a missing output folder is reported, not silently ignored', async () => {
  const src = tmpDir();
  const p = path.join(src, 'a.pdf');
  fs.copyFileSync(fixture('a.pdf'), p);
  const { app, win } = await launch(path.join(tmpDir(), 'unplugged'));
  try {
    await win.setInputFiles('#file-input', [p]);
    await win.fill('#f-title', 'T');
    await win.click('#apply');
    await expect(win.locator('#notice')).toContainText('Output folder not found');
  } finally {
    await app.close();
  }
});

// --- Pre-filling the form from a file ---------------------------------------------

const { runBatch } = require('../src/batch');

async function taggedPdf(name, title, author) {
  const stage = tmpDir();
  const src = path.join(stage, 'in.pdf');
  fs.copyFileSync(fixture('a.pdf'), src);
  const outDir = tmpDir();
  const [r] = await runBatch({ files: [{ path: src, title }], form: { fields: { author: { value: author, clear: false } }, custom: [] }, outDir });
  if (!r.ok) throw new Error(r.error);
  const dest = path.join(tmpDir(), name);
  fs.copyFileSync(path.join(outDir, 'in.pdf'), dest);
  return dest;
}

test('one file pre-fills the form; on Apply only edited and kept values remain', async () => {
  const p = await taggedPdf('briefing.pdf', 'Original title', 'Original author');
  const out = tmpDir();
  const { app, win } = await launch(out);
  try {
    await win.setInputFiles('#file-input', [p]);
    await expect(win.locator('#f-title')).toHaveValue('Original title');
    await expect(win.locator('#f-author')).toHaveValue('Original author');
    await expect(win.locator('#f-pdf_title')).toHaveValue('Original title');
    await expect(win.locator('#s-title')).toHaveText('Will be wiped');
    await win.check('#k-title');
    await expect(win.locator('#s-title')).toHaveText('Kept');
    await win.click('#tab-pdf');
    await expect(win.locator('#k-pdf_title')).toBeChecked(); // same tags, kept together
    await win.click('#tab-common');
    await win.fill('#f-author', 'New author');
    await expect(win.locator('#s-author')).toHaveText('Changed');
    await win.click('#apply');
    await expect(win.locator('#dialog-title')).toContainText('Wipe');
    await win.click('#dialog-actions button[value="ok"]');
    await expect(win.locator('.file.ok')).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await app.close();
  }
  const raw = await readRaw(path.join(out, 'briefing.pdf'));
  expect(raw['PDF:Author']).toBe('New author');
  expect(raw['PDF:Title']).toBe('Original title');
});

test('untouched values that are not kept are wiped; Keep all keeps everything', async () => {
  const p = await taggedPdf('briefing.pdf', 'Title A', 'Author A');
  const outWipe = tmpDir();
  let launched = await launch(outWipe);
  try {
    await launched.win.setInputFiles('#file-input', [p]);
    await expect(launched.win.locator('#f-title')).toHaveValue('Title A');
    await launched.win.fill('#f-subject', 'New subject');
    await launched.win.click('#apply');
    await launched.win.click('#dialog-actions button[value="ok"]');
    await expect(launched.win.locator('.file.ok')).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await launched.app.close();
  }
  let raw = await readRaw(path.join(outWipe, 'briefing.pdf'));
  expect(raw['PDF:Subject']).toBe('New subject');
  expect(raw['PDF:Title']).toBeUndefined();
  expect(raw['PDF:Author']).toBeUndefined();

  const outKeep = tmpDir();
  launched = await launch(outKeep);
  try {
    await launched.win.setInputFiles('#file-input', [p]);
    await expect(launched.win.locator('#f-title')).toHaveValue('Title A');
    await launched.win.click('#keep-all');
    await launched.win.fill('#f-subject', 'New subject');
    await launched.win.click('#apply');
    await launched.win.click('#dialog-actions button[value="ok"]');
    await expect(launched.win.locator('.file.ok')).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await launched.app.close();
  }
  raw = await readRaw(path.join(outKeep, 'briefing.pdf'));
  expect(raw['PDF:Subject']).toBe('New subject');
  expect(raw['PDF:Title']).toBe('Title A');
  expect(raw['PDF:Author']).toBe('Author A');
});

test('emptying a pre-filled field removes that value from the file', async () => {
  const p = await taggedPdf('briefing.pdf', 'Keep me', 'Remove me');
  const out = tmpDir();
  const { app, win } = await launch(out);
  try {
    await win.setInputFiles('#file-input', [p]);
    await expect(win.locator('#f-author')).toHaveValue('Remove me');
    await win.check('#k-title');
    await win.fill('#f-author', '');
    await win.click('#apply');
    await win.click('#dialog-actions button[value="ok"]');
    await expect(win.locator('.file.ok')).toHaveCount(1, { timeout: 30_000 });
  } finally {
    await app.close();
  }
  const raw = await readRaw(path.join(out, 'briefing.pdf'));
  expect(raw['PDF:Author']).toBeUndefined();
  expect(raw['PDF:Title']).toBe('Keep me');
});

test('in a batch, Load details fills the form from the chosen file', async () => {
  const one = await taggedPdf('one.pdf', 'First', 'A');
  const two = await taggedPdf('two.pdf', 'Second', 'B');
  const { app, win } = await launch(tmpDir());
  try {
    await win.setInputFiles('#file-input', [one, two]);
    await expect(win.locator('#count')).toHaveText('2 / 20');
    await expect(win.locator('#f-title')).toHaveValue(''); // two files: nothing pre-filled
    await win.locator('.file').nth(1).getByRole('button', { name: 'Load details' }).click();
    await expect(win.locator('#f-title')).toHaveValue('Second');
    await expect(win.locator('#notice')).toContainText('two.pdf');
  } finally {
    await app.close();
  }
});
