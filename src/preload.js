// The only bridge between the window and the main process.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('bme', {
  // Electron no longer exposes File.path; this is how a dropped file's path is found.
  pathFor: (file) => webUtils.getPathForFile(file),
  fields: invoke('fields'),
  validate: invoke('validate'),
  pickFiles: invoke('pick-files'),
  pickImage: invoke('pick-image'),
  readCurrent: invoke('read-current'),
  getOutputFolder: invoke('get-output-folder'),
  pickOutputFolder: invoke('pick-output-folder'),
  planOutputs: invoke('plan-outputs'),
  apply: invoke('apply'),
  openFolder: invoke('open-folder'),
  onProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('progress', listener);
    return () => ipcRenderer.removeListener('progress', listener);
  },
  presets: {
    list: invoke('presets:list'),
    save: invoke('presets:save'),
    load: invoke('presets:load'),
    remove: invoke('presets:remove'),
  },
});
