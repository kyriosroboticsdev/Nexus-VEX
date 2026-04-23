const { contextBridge, ipcRenderer } = require('electron');

// Exposes a safe, controlled API to the renderer (app.js / index.html).
// Nothing from Node.js leaks through — only what is explicitly listed here.

contextBridge.exposeInMainWorld('electronAPI', {

  // Always true when running inside Electron — app.js checks this to
  // decide whether to show desktop-only features.
  isElectron: true,

  // ── File access ──────────────────────────────────────────────────────────
  openFileDialog: (filters) =>
    ipcRenderer.invoke('open-file-dialog', { filters }),

  getFileUrl: (filePath) =>
    ipcRenderer.invoke('get-file-url', filePath),

  // ── yt-dlp ───────────────────────────────────────────────────────────────
  checkYtdlp: () =>
    ipcRenderer.invoke('check-ytdlp'),

  downloadClip: (url, startTime, endTime) =>
    ipcRenderer.invoke('ytdlp-download', { url, startTime, endTime }),

  onDownloadProgress: (callback) =>
    ipcRenderer.on('ytdlp-progress', (_event, data) => callback(data)),

  removeDownloadListeners: () =>
    ipcRenderer.removeAllListeners('ytdlp-progress'),

  // ── Google OAuth ──────────────────────────────────────────────────────────
  googleAuth: (authUrl) =>
    ipcRenderer.invoke('google-auth', authUrl),

  // ── Updates ───────────────────────────────────────────────────────────────
  onUpdateStatus: (callback) =>
    ipcRenderer.on('update-status', (_event, msg) => callback(msg)),

  // ── Utilities ─────────────────────────────────────────────────────────────

  // STL Model Library
  stlSave:   (srcPath)  => ipcRenderer.invoke('stl-save', srcPath),
  stlList:   ()         => ipcRenderer.invoke('stl-list'),
  stlDelete: (name)     => ipcRenderer.invoke('stl-delete', name),
  stlRead:   (filePath) => ipcRenderer.invoke('stl-read', filePath),
  snapshotSave: (dataUrl) => ipcRenderer.invoke('snapshot-save', dataUrl),
  simLoadConfig:   ()         => ipcRenderer.invoke('sim:loadConfig'),
  simSaveConfig:   (config)   => ipcRenderer.invoke('sim:saveConfig', config),
  simPickFieldObj: ()         => ipcRenderer.invoke('sim:pickFieldObj'),
  simGetFieldPath: ()         => ipcRenderer.invoke('sim:getFieldPath'),


  openExternal: (url) =>
    ipcRenderer.invoke('open-external', url),

  // ── Code IDE ──────────────────────────────────────────────────────────────
  ideCheckPros:      ()                    => ipcRenderer.invoke('ide:checkPros'),
  ideCheckToolchain:  ()                    => ipcRenderer.invoke('ide:checkToolchain'),
  ideInstallLibrary:  (opts)                => ipcRenderer.invoke('ide:installLibrary', opts),
  ideGetProjectsDir:()                    => ipcRenderer.invoke('ide:getProjectsDir'),
  idePickFolder:    ()                    => ipcRenderer.invoke('ide:pickFolder'),
  ideListDir:       (dirPath)             => ipcRenderer.invoke('ide:listDir',     dirPath),
  ideReadFile:      (filePath)            => ipcRenderer.invoke('ide:readFile',    filePath),
  ideWriteFile:     (filePath, content)   => ipcRenderer.invoke('ide:writeFile',   filePath, content),
  ideNewProject:    (opts)                => ipcRenderer.invoke('ide:newProject',  opts),
  ideRunCommand:    (opts)                => ipcRenderer.invoke('ide:runCommand',  opts),
  ideStopCommand:   ()                    => ipcRenderer.invoke('ide:stopCommand'),
  onIdeOutput:      (cb)                  => ipcRenderer.on('ide:output', (_e, d) => cb(d)),
  removeIdeOutputListeners: ()            => ipcRenderer.removeAllListeners('ide:output'),
  onProsStatus:     (cb)                  => ipcRenderer.on('pros:status', (_e, d) => cb(d)),
  ideBrowseExe:     ()                    => ipcRenderer.invoke('ide:browseExe'),
  ideBrowseDir:     ()                    => ipcRenderer.invoke('ide:browseDir'),
  ideMkdir:         (dirPath)             => ipcRenderer.invoke('ide:mkdir', dirPath),
  settingsGet:      ()                    => ipcRenderer.invoke('settings:get'),
  settingsSet:      (s)                   => ipcRenderer.invoke('settings:set', s),

});
