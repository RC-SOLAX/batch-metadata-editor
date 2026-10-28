// Electron main process: the window, settings, and the IPC surface the UI uses.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { validateBatch, runBatch, outputPaths, checkOutDir } = require('./batch');
const { FIELDS, TABS } = require('./fields');
const { familyOf, ACCEPTED } = require('./formats');
const { createPresets } = require('./presets');
const exiftool = require('./writers/exiftool');
const { readMetadata, readForPrefill } = require('./prefill');

// Set by the end-to-end test so no folder dialog is shown. Read once, here.
const TEST_OUTDIR = process.env.BME_TEST_OUTDIR || null;

let win = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const presets = () => createPresets(path.join(app.getPath('userData'), 'presets'));

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
  return next;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'Batch Metadata Editor',
    autoHideMenuBar: true,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // A file dropped outside the drop zone must never replace the app page.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
}


function registerIpc() {
  ipcMain.handle('fields', () => ({ fields: FIELDS, tabs: TABS }));

  ipcMain.handle('validate', (_e, paths, current) => {
    const r = validateBatch(paths, current);
    return { ...r, accepted: r.accepted.map((p) => ({ path: p, name: path.basename(p), family: familyOf(p) })) };
  });

  ipcMain.handle('pick-files', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported files', extensions: ACCEPTED.map((e) => e.slice(1)) },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('pick-image', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose cover art',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('read-current', async (_e, file) => {
    const all = await readMetadata(file);
    // Drop the writer's internal aliases; the panel shows what is in the file.
    return Object.fromEntries(Object.entries(all).filter(([k, v]) => !k.endsWith('@file') && k !== 'EXIF:GPS' && v !== undefined));
  });

  ipcMain.handle('prefill', (_e, file) => readForPrefill(file));

  ipcMain.handle('get-output-folder', () => {
    if (TEST_OUTDIR) return TEST_OUTDIR;
    const dir = loadSettings().outDir;
    return dir && fs.existsSync(dir) ? dir : null;
  });

  ipcMain.handle('pick-output-folder', async () => {
    if (TEST_OUTDIR) return TEST_OUTDIR;
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose where to save the edited copies',
      defaultPath: loadSettings().outDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled) return null;
    saveSettings({ outDir: r.filePaths[0] });
    return r.filePaths[0];
  });

  ipcMain.handle('plan-outputs', (_e, paths, outDir) => {
    // Refuse a missing folder or one holding the originals before the UI can
    // offer to overwrite anything there.
    checkOutDir(paths, outDir);
    const existing = new Set(fs.readdirSync(outDir).map((n) => n.toLowerCase()));
    return outputPaths(paths, outDir, existing).conflicts.map((p) => path.basename(p));
  });

  ipcMain.handle('apply', (_e, job) => runBatch(job, (p) => win && win.webContents.send('progress', p)));

  ipcMain.handle('open-folder', (_e, dir) => shell.openPath(dir));

  ipcMain.handle('presets:list', () => presets().list());
  ipcMain.handle('presets:save', (_e, name, form) => presets().save(name, form));
  ipcMain.handle('presets:load', (_e, name) => presets().load(name));
  ipcMain.handle('presets:remove', (_e, name) => presets().remove(name));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  exiftool.endShared();
});
