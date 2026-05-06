const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path   = require('path');
const { spawn, execSync } = require('child_process');
const fs     = require('fs');
const os     = require('os');
const { autoUpdater } = require('electron-updater');

// Resolve the full path to pros.exe without relying on PATH.
// Electron launched from a shortcut/taskbar does not inherit the user's PATH,
// so spawning 'pros' directly fails even when it is installed.
function _findProsExe() {
  const settings = _loadSettingsSafe();
  if (settings.prosCliPath && fs.existsSync(settings.prosCliPath)) return settings.prosCliPath;

  const local  = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const roaming = process.env.APPDATA     || path.join(os.homedir(), 'AppData', 'Roaming');
  const bases = [
    path.join(local,   'Programs', 'Python'),
    path.join(roaming, 'Python'),
    'C:\\Python313', 'C:\\Python312', 'C:\\Python311', 'C:\\Python310',
  ];
  for (const base of bases) {
    try {
      for (const ver of fs.readdirSync(base)) {
        const exe = path.join(base, ver, 'Scripts', 'pros.exe');
        if (fs.existsSync(exe)) return exe;
      }
    } catch {}
    try {
      const exe = path.join(base, 'Scripts', 'pros.exe');
      if (fs.existsSync(exe)) return exe;
    } catch {}
  }
  return 'pros'; // last-resort: hope it's in PATH
}

// _loadSettings is defined later in the file; this safe variant avoids
// calling it before it is defined (used only by _findProsExe at call time).
function _loadSettingsSafe() {
  try { return _loadSettings(); } catch { return {}; }
}

// Allow the renderer and main process to address large CAD assemblies (1 GB+).
// Must be set before app.whenReady().
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

// ─── WINDOW ───────────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width:  1440,
    height: 900,
    minWidth:  900,
    minHeight: 600,
    title: 'Nexus',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadFile('index.html');
  return win;
}

app.whenReady().then(() => {
  const win = createWindow();
  win.webContents.once('did-finish-load', () => checkAndInstallPros(win));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Only check for updates in a packaged build, not during development.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

// ─── PROS AUTO-INSTALL ────────────────────────────────────────────────────────

function send(win, type, message) {
  if (!win.isDestroyed()) win.webContents.send('pros:status', { type, message });
}

async function checkAndInstallPros(win) {
  send(win, 'checking', 'Checking PROS CLI…');

  const prosOk = await new Promise(resolve => {
    const p = spawn(_findProsExe(), ['--version'], { shell: true });
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.on('close', code => resolve(code === 0 ? out.trim() : null));
    p.on('error', () => resolve(null));
  });

  if (prosOk) {
    send(win, 'ok', `PROS CLI ready (${prosOk})`);
    return;
  }

  send(win, 'installing', 'PROS CLI not found — installing via pip…');

  // Find pip (try pip3 first, then pip)
  const pip = await new Promise(resolve => {
    const p = spawn('pip3', ['--version'], { shell: true });
    p.on('close', code => resolve(code === 0 ? 'pip3' : null));
    p.on('error', () => resolve(null));
  }) ?? await new Promise(resolve => {
    const p = spawn('pip', ['--version'], { shell: true });
    p.on('close', code => resolve(code === 0 ? 'pip' : null));
    p.on('error', () => resolve(null));
  });

  if (!pip) {
    send(win, 'error', 'pip not found. Install Python from python.org, then run: pip install pros-cli');
    return;
  }

  const proc = spawn(pip, ['install', 'pros-cli'], { shell: true });

  proc.stdout.on('data', d => send(win, 'progress', d.toString().trim()));
  proc.stderr.on('data', d => send(win, 'progress', d.toString().trim()));

  proc.on('close', code => {
    if (code === 0) send(win, 'success', 'PROS CLI installed successfully! Restart Nexus to activate.');
    else send(win, 'error', 'pip install failed. Run manually: pip install pros-cli');
  });

  proc.on('error', () => {
    send(win, 'error', 'Could not run pip. Run manually: pip install pros-cli');
  });
}

// ─── AUTO-UPDATER ─────────────────────────────────────────────────────────────

autoUpdater.on('update-available', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-status', 'Downloading update…');
});

autoUpdater.on('update-downloaded', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('update-status', 'Update ready — restart to install');
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Ready',
      message: 'A new version of Nexus has been downloaded. Restart the app to apply it.',
      buttons: ['Restart Now', 'Later'],
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  }
});

autoUpdater.on('error', (err) => {
  console.error('Auto-updater error:', err.message);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: FILE DIALOG ─────────────────────────────────────────────────────────

ipcMain.handle('open-file-dialog', async (event, { filters }) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return result.filePaths[0] || null;
});

// ─── IPC: LOAD LOCAL VIDEO ────────────────────────────────────────────────────
// Returns a file:// URL the renderer can set as a <video> src.

ipcMain.handle('get-file-url', (_event, filePath) => {
  return `file://${filePath.replace(/\\/g, '/')}`;
});

// ─── IPC: YT-DLP DOWNLOAD ─────────────────────────────────────────────────────
// Downloads a time-windowed clip from a YouTube URL.
// Sends 'ytdlp-progress' events back to the renderer during download.

ipcMain.handle('ytdlp-download', async (event, { url, startTime, endTime }) => {
  const outPath = path.join(os.tmpdir(), `nexus_clip_${Date.now()}.mp4`);

  return new Promise((resolve, reject) => {
    const args = [
      '--download-sections', `*${startTime}-${endTime}`,
      '-f', 'best[height<=720][ext=mp4]/best[height<=720]/best',
      '-o', outPath,
      url,
    ];

    const proc = spawn('yt-dlp', args);

    proc.stdout.on('data', d => {
      event.sender.send('ytdlp-progress', { type: 'stdout', text: d.toString() });
    });
    proc.stderr.on('data', d => {
      event.sender.send('ytdlp-progress', { type: 'stderr', text: d.toString() });
    });
    proc.on('close', code => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`yt-dlp exited with code ${code}`));
    });
    proc.on('error', err => {
      reject(new Error(
        err.code === 'ENOENT'
          ? 'yt-dlp not found — install it from https://github.com/yt-dlp/yt-dlp'
          : err.message
      ));
    });
  });
});

// ─── IPC: CHECK YT-DLP ────────────────────────────────────────────────────────

ipcMain.handle('check-ytdlp', async () => {
  return new Promise(resolve => {
    const proc = spawn('yt-dlp', ['--version']);
    proc.on('close', code => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
});

// ─── IPC: OPEN EXTERNAL LINK ──────────────────────────────────────────────────

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
});

// ─── IPC: STL MODEL LIBRARY ───────────────────────────────────────────────────

const modelsDir = path.join(app.getPath('userData'), 'models');
fs.mkdirSync(modelsDir, { recursive: true });

// Helper: find adjacent .mtl file for an OBJ path (same dir, same base name)
function mtlPathFor(objPath) {
  return objPath.replace(/\.obj$/i, '.mtl');
}

ipcMain.handle('stl-save', async (event, srcPath) => {
  const name = path.basename(srcPath);
  const dest = path.join(modelsDir, name);
  const isObj = path.extname(srcPath).toLowerCase() === '.obj';
  const srcMtl = isObj ? mtlPathFor(srcPath) : null;
  const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];

  if (fs.existsSync(dest)) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Replace', 'Keep Both', 'Cancel'],
      title: 'File Already Exists',
      message: `"${name}" already exists in your model library.`,
    });
    if (response === 2) return null;
    if (response === 1) {
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      const ts = Date.now();
      const newName = `${base}_${ts}${ext}`;
      const newDest = path.join(modelsDir, newName);
      fs.copyFileSync(srcPath, newDest);
      if (srcMtl && fs.existsSync(srcMtl)) {
        fs.copyFileSync(srcMtl, mtlPathFor(newDest));
      }
      return { name: newName, path: newDest };
    }
  }
  fs.copyFileSync(srcPath, dest);
  if (srcMtl && fs.existsSync(srcMtl)) {
    fs.copyFileSync(srcMtl, mtlPathFor(dest));
  }
  return { name, path: dest };
});

ipcMain.handle('stl-list', async () => {
  if (!fs.existsSync(modelsDir)) return [];
  return fs.readdirSync(modelsDir)
    .filter(f => /\.(stl|glb|gltf|obj)$/i.test(f))
    .map(f => ({ name: f, path: path.join(modelsDir, f) }));
});

ipcMain.handle('stl-delete', async (_event, name) => {
  const p = path.join(modelsDir, name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  // Also remove paired .mtl if this was an OBJ
  if (path.extname(name).toLowerCase() === '.obj') {
    const mtl = mtlPathFor(p);
    if (fs.existsSync(mtl)) fs.unlinkSync(mtl);
  }
});

ipcMain.handle('stl-read', async (event, filePath) => {
  const ext = path.extname(filePath).toLowerCase();

  function safeRead(p) {
    const raw = fs.readFileSync(p);
    const copy = Buffer.allocUnsafe(raw.length);
    raw.copy(copy);
    return new Uint8Array(copy.buffer, copy.byteOffset, copy.length);
  }

  // Warn before loading very large files so the user isn't surprised by long
  // wait times or an out-of-memory crash.
  const WARN_THRESHOLD = 256 * 1024 * 1024; // 256 MB
  const fileSize = fs.statSync(filePath).size;
  if (fileSize > WARN_THRESHOLD) {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
    const sizeMB = (fileSize / (1024 * 1024)).toFixed(0);
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Load Anyway', 'Cancel'],
      title: 'Large Model File',
      message: `This model is ${sizeMB} MB. Loading may take a while and use significant memory.`,
      detail: 'Complex robot assemblies can be rendered but may be slow to load.',
    });
    if (response === 1) return null;
  }

  if (ext === '.obj') {
    // Parse OBJ in the main process via streaming — reads line by line so the
    // full file text is never held in memory all at once. Only the parsed
    // Float32 geometry arrays are sent over IPC, which is far smaller than the
    // raw text and avoids the extra TextDecoder copy in the renderer.
    const mtlPath = filePath.replace(/\.obj$/i, '.mtl');
    const matMap = new Map();
    if (fs.existsSync(mtlPath)) {
      let cur = null, kd = null;
      for (const line of fs.readFileSync(mtlPath, 'utf8').split('\n')) {
        const t = line.trim();
        if (t.startsWith('newmtl ')) {
          if (cur !== null) matMap.set(cur, kd ?? [0.8, 0.8, 0.8]);
          cur = t.slice(7).trim(); kd = null;
        } else if (t.startsWith('Kd ')) {
          const p = t.split(/\s+/);
          kd = [+p[1], +p[2], +p[3]];
        }
      }
      if (cur !== null) matMap.set(cur, kd ?? [0.8, 0.8, 0.8]);
    }

    const groups = await new Promise((resolve, reject) => {
      const vPos = [], vNor = [];
      const groupMap = new Map();
      let curMat = '__default__';

      const rl = require('readline').createInterface({
        input: fs.createReadStream(filePath),
        crlfDelay: Infinity,
      });

      rl.on('line', (raw) => {
        const t = raw.trim();
        if (t[0] === 'v' && t[1] === ' ') {
          const p = t.split(/\s+/);
          vPos.push(+p[1], +p[2], +p[3]);
        } else if (t[0] === 'v' && t[1] === 'n' && t[2] === ' ') {
          const p = t.split(/\s+/);
          vNor.push(+p[1], +p[2], +p[3]);
        } else if (t.startsWith('usemtl ')) {
          curMat = t.slice(7).trim();
        } else if (t[0] === 'f' && t[1] === ' ') {
          if (!groupMap.has(curMat)) groupMap.set(curMat, { pos: [], nor: [] });
          const g = groupMap.get(curMat);
          const face = t.slice(2).trim().split(/\s+/).map(tok => {
            const pts = tok.split('/');
            return { vi: (+pts[0] - 1) * 3, ni: pts[2] ? (+pts[2] - 1) * 3 : -1 };
          });
          for (let i = 1; i < face.length - 1; i++) {
            for (const v of [face[0], face[i], face[i + 1]]) {
              g.pos.push(vPos[v.vi], vPos[v.vi + 1], vPos[v.vi + 2]);
              if (v.ni >= 0) g.nor.push(vNor[v.ni], vNor[v.ni + 1], vNor[v.ni + 2]);
            }
          }
        }
      });

      rl.on('close', () => {
        const result = [];
        for (const [name, g] of groupMap) {
          if (!g.pos.length) continue;
          result.push({
            name,
            positions: new Float32Array(g.pos),
            normals: g.nor.length === g.pos.length ? new Float32Array(g.nor) : null,
            color: matMap.get(name) ?? [0.72, 0.74, 0.78],
          });
        }
        resolve(result);
      });

      rl.on('error', reject);
    });

    return { type: 'obj-geo', groups };
  }

  const data = safeRead(filePath);
  const type = (ext === '.glb' || ext === '.gltf') ? ext.slice(1) : 'stl';
  return { type, data };
});

ipcMain.handle('snapshot-save', async (_event, dataUrl) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Save View',
    defaultPath: 'cad-view.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });
  if (!filePath) return null;
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
  return filePath;
});

// ─── IPC: GOOGLE AUTH (ELECTRON OAUTH FLOW) ───────────────────────────────────
// Opens a child BrowserWindow for Google sign-in and intercepts the redirect
// back to vexscout.vercel.app to extract the access token without navigating
// the main window away from the Electron app.

ipcMain.handle('google-auth', async (event, authUrl) => {
  return new Promise((resolve, reject) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const authWin = new BrowserWindow({
      width: 500,
      height: 650,
      parent,
      modal: true,
      title: 'Sign in with Google',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    authWin.loadURL(authUrl);

    const tryExtract = (url) => {
      if (!url.includes('vexscout.vercel.app')) return false;
      const hash = url.split('#')[1] || '';
      const token = new URLSearchParams(hash).get('access_token');
      if (!token) return false;
      resolve(token);
      authWin.destroy();
      return true;
    };

    authWin.webContents.on('will-redirect', (e, url) => {
      if (tryExtract(url)) e.preventDefault();
    });

    authWin.webContents.on('will-navigate', (e, url) => {
      if (tryExtract(url)) e.preventDefault();
    });

    authWin.webContents.on('did-navigate', (_e, url) => {
      tryExtract(url);
    });

    // Fallback: read the URL from the renderer after page load (catches JS-driven redirects)
    authWin.webContents.on('did-finish-load', () => {
      authWin.webContents.executeJavaScript('location.href').then(url => tryExtract(url)).catch(() => {});
    });

    authWin.on('closed', () => {
      reject(new Error('closed'));
    });
  });
});

// Where simulation configs are stored — one folder per robot
const SIM_DIR = path.join(app.getPath('userData'), 'simconfigs');
if (!fs.existsSync(SIM_DIR)) fs.mkdirSync(SIM_DIR, { recursive: true });
 
// Load a simulation.json — opens a file picker so the user selects their robot folder
ipcMain.handle('sim:loadConfig', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open simulation.json',
    filters: [{ name: 'Simulation Config', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
 
  const filePath = result.filePaths[0];
  try {
    const raw  = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(raw);
    // Resolve OBJ path relative to the config file's folder if it's relative
    if (config.objPath && !path.isAbsolute(config.objPath)) {
      config.objPath = path.resolve(path.dirname(filePath), config.objPath);
    }
    if (config.mtlPath && !path.isAbsolute(config.mtlPath)) {
      config.mtlPath = path.resolve(path.dirname(filePath), config.mtlPath);
    }
    return config;
  } catch (e) {
    return null;
  }
});
 
// Return the bundled field OBJ path (same directory as main.js)
ipcMain.handle('sim:getFieldPath', () => {
  const p = path.join(__dirname, 'Field - Empty.obj');
  return fs.existsSync(p) ? p : null;
});

// Open a file picker and return the selected OBJ path (for the field model)
ipcMain.handle('sim:pickFieldObj', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Field OBJ',
    filters: [{ name: 'OBJ Files', extensions: ['obj'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Save a simulation.json — opens a save dialog
ipcMain.handle('sim:saveConfig', async (event, config) => {
  const result = await dialog.showSaveDialog({
    title: 'Save simulation.json',
    defaultPath: path.join(SIM_DIR, 'simulation.json'),
    filters: [{ name: 'Simulation Config', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, JSON.stringify(config, null, 2), 'utf8');
  return true;
});

// ─── IPC: CODE IDE ────────────────────────────────────────────────────────────

const PROJECTS_DIR = path.join(app.getPath('userData'), 'projects');
fs.mkdirSync(PROJECTS_DIR, { recursive: true });

ipcMain.handle('ide:checkPros', () => new Promise(resolve => {
  const p = spawn(_findProsExe(), ['--version'], { shell: true });
  let out = '';
  p.stdout.on('data', d => { out += d.toString(); });
  p.on('close', code => {
    if (code !== 0) return resolve(null);
    const m = out.match(/(\d+\.\d+[\.\d]*)/);
    resolve(m ? m[1] : out.trim());
  });
  p.on('error', () => resolve(null));
}));

ipcMain.handle('ide:checkToolchain', async () => {
  const settings = _loadSettings();
  const env = { ...process.env };
  if (settings.toolchainBinPath) env.PATH = settings.toolchainBinPath + path.delimiter + (env.PATH || '');
  return new Promise(resolve => {
    const p = spawn('arm-none-eabi-gcc', ['--version'], { shell: true, env });
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.on('close', code => {
      if (code !== 0) return resolve(null);
      const m = out.match(/(\d+\.\d+[\.\d]*)/);
      resolve(m ? m[1] : out.split('\n')[0].trim());
    });
    p.on('error', () => resolve(null));
  });
});

ipcMain.handle('ide:getProjectsDir', () => PROJECTS_DIR);

ipcMain.handle('ide:pickFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(win, {
    title: 'Open PROS Project Folder',
    properties: ['openDirectory'],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('ide:listDir', async (_event, dirPath) => {
  try {
    const SKIP = new Set(['.git', 'node_modules', '.vscode', '__pycache__', '.pros']);
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && !SKIP.has(e.name))
      .map(e => ({ name: e.name, path: path.join(dirPath, e.name), isDir: e.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch { return []; }
});

ipcMain.handle('ide:readFile', async (_event, filePath) => {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch { return null; }
});

ipcMain.handle('ide:writeFile', async (_event, filePath, content) => {
  try { fs.writeFileSync(filePath, content, 'utf8'); return true; }
  catch { return false; }
});

const _ideProcesses = new Map();

ipcMain.handle('ide:runCommand', async (event, { cmd, args, cwd }) => {
  const existing = _ideProcesses.get('main');
  if (existing) { try { existing.kill(); } catch {} _ideProcesses.delete('main'); }

  // Apply custom PROS path and toolchain from settings
  const settings = _loadSettings();
  let actualCmd = cmd === 'pros' ? _findProsExe() : cmd;
  const env = { ...process.env };
  if (settings.toolchainBinPath) {
    env.PATH = settings.toolchainBinPath + path.delimiter + (env.PATH || '');
    // PROS CLI uses PROS_TOOLCHAIN to locate arm-none-eabi-gcc and make.
    // It expects the directory whose bin/ sub-folder contains the tools.
    env.PROS_TOOLCHAIN = path.dirname(settings.toolchainBinPath);
  }
  // MinGW bash.exe (used by make) looks for C:\tmp as /tmp in its virtual FS.
  try { fs.mkdirSync('C:\\tmp', { recursive: true }); } catch {}
  const tmp = os.tmpdir();
  env.TEMP   = env.TEMP   || tmp;
  env.TMP    = env.TMP    || tmp;
  env.TMPDIR = env.TMPDIR || tmp;

  return new Promise(resolve => {
    const proc = spawn(actualCmd, args, { cwd, shell: true, env });
    _ideProcesses.set('main', proc);

    proc.stdout.on('data', d => { event.sender.send('ide:output', { text: d.toString(), type: 'stdout' }); });
    proc.stderr.on('data', d => { event.sender.send('ide:output', { text: d.toString(), type: 'stderr' }); });
    proc.on('close', code => { _ideProcesses.delete('main'); resolve(code ?? 0); });
    proc.on('error', err => {
      event.sender.send('ide:output', { text: `Error: ${err.message}\n`, type: 'error' });
      _ideProcesses.delete('main');
      resolve(-1);
    });
  });
});

ipcMain.handle('ide:stopCommand', () => {
  const proc = _ideProcesses.get('main');
  if (proc) { try { proc.kill(); } catch {} _ideProcesses.delete('main'); return true; }
  return false;
});

ipcMain.handle('ide:newProject', async (event, { name, location, library }) => {
  const projectPath = path.join(location || PROJECTS_DIR, name);
  fs.mkdirSync(path.join(projectPath, 'src'),     { recursive: true });
  fs.mkdirSync(path.join(projectPath, 'include'), { recursive: true });

  const prosExe = _findProsExe();
  const prosAvail = await new Promise(resolve => {
    const p = spawn(prosExe, ['--version'], { shell: true });
    p.on('close', code => resolve(code === 0));
    p.on('error', () => resolve(false));
  });

  if (prosAvail) {
    return new Promise(resolve => {
      const args = ['conductor', 'new-project', projectPath];
      const proc = spawn(prosExe, args, { shell: true });
      let output = '';
      proc.stdout.on('data', d => { output += d.toString(); });
      proc.stderr.on('data', d => { output += d.toString(); });
      proc.on('close', code => {
        if (code !== 0) {
          _ideScaffoldProject(projectPath, name, library);
          output += '\n(Scaffolded manually — run `pros conductor new-project` in the folder for full setup)';
        }
        resolve({ path: projectPath, output, usedCLI: code === 0, success: true });
      });
      proc.on('error', () => {
        _ideScaffoldProject(projectPath, name, library);
        resolve({ path: projectPath, output: 'Scaffolded manually.', usedCLI: false, success: true });
      });
    });
  }

  _ideScaffoldProject(projectPath, name, library);
  return {
    path: projectPath,
    output: `Project "${name}" scaffolded.\n\nTo build, install PROS CLI from:\nhttps://pros.cs.purdue.edu/v5/getting-started/\n`,
    usedCLI: false,
    success: true,
  };
});

ipcMain.handle('ide:installLibrary', (event, { library, projectPath }) => {
  const prosExe = _findProsExe();
  const settings = _loadSettings();
  const env = { ...process.env };
  if (settings.toolchainBinPath) {
    env.PATH = settings.toolchainBinPath + path.delimiter + (env.PATH || '');
    env.PROS_TOOLCHAIN = path.dirname(settings.toolchainBinPath);
  }
  try { fs.mkdirSync('C:\\tmp', { recursive: true }); } catch {}

  const steps =
    library === 'lemlib' ? [
      [prosExe, ['conductor', 'add-depot', '--name', 'lemlib',
                 '--url', 'https://github.com/LemLib/LemLib/releases/latest/download/LemLib.json']],
      [prosExe, ['conductor', 'fetch', 'LemLib']],
      [prosExe, ['conductor', 'apply', 'LemLib', '--project', projectPath]],
    ] : [];

  if (!steps.length) return Promise.resolve({ success: false, output: `Unknown library: ${library}` });

  return new Promise(resolve => {
    let output = '';
    function runStep(i) {
      if (i >= steps.length) return resolve({ success: true, output });
      const [cmd, args] = steps[i];
      const proc = spawn(cmd, args, { cwd: projectPath, shell: true, env });
      proc.stdout.on('data', d => {
        output += d.toString();
        event.sender.send('ide:output', { text: d.toString(), type: 'stdout' });
      });
      proc.stderr.on('data', d => {
        output += d.toString();
        event.sender.send('ide:output', { text: d.toString(), type: 'stderr' });
      });
      proc.on('close', code => {
        if (code !== 0 && i === 0) { runStep(i + 1); return; } // depot add may fail if already added
        if (code !== 0) return resolve({ success: false, output });
        runStep(i + 1);
      });
      proc.on('error', err => resolve({ success: false, output: output + `\nError: ${err.message}` }));
    }
    runStep(0);
  });
});

function _ideScaffoldProject(projectPath, name, library) {
  const mainH = `#pragma once
#include "api.h"
`;

  const mains = {
    blank: `#include "main.h"

void initialize() {}
void disabled() {}
void competition_initialize() {}

void autonomous() {
\t// Write your autonomous code here
}

void opcontrol() {
\tpros::Controller master(pros::E_CONTROLLER_MASTER);
\twhile (true) {
\t\t// Driver control code here
\t\tpros::delay(20);
\t}
}
`,
    lemlib: `#include "main.h"
#include "lemlib/api.hpp"

// ── Motors (replace port numbers with yours) ──────────────────────────────────
pros::MotorGroup leftDrive ({-1, -2, -3}, pros::MotorGearset::blue);
pros::MotorGroup rightDrive({ 4,  5,  6}, pros::MotorGearset::blue);
pros::Imu imu(7);

// ── LemLib chassis ───────────────────────────────────────────────────────────
lemlib::Drivetrain drivetrain(
    &leftDrive, &rightDrive,
    12.5,                            // track width (in)
    lemlib::Omniwheel::NEW_325,      // wheel size
    450,                             // drivetrain RPM
    2                                // horizontal drift
);
lemlib::OdomSensors sensors(nullptr, nullptr, nullptr, nullptr, &imu);
lemlib::ControllerSettings linearPID {10, 0, 3, 3, 1, 100, 3, 500, 20};
lemlib::ControllerSettings angularPID{2,  0, 10, 3, 1, 100, 3, 500, 20};

lemlib::Chassis chassis(drivetrain, linearPID, angularPID, sensors);

void initialize() {
    pros::lcd::initialize();
    chassis.calibrate();
    pros::lcd::print(0, "Calibrating IMU…");
    while (chassis.isCalibrating()) pros::delay(10);
    pros::lcd::print(0, "Ready.");
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
    // Example: move to (24, 24) facing 90°
    chassis.moveToPose(24, 24, 90, 4000);
}

void opcontrol() {
    while (true) {
        int leftY  = master.get_analog(pros::E_CONTROLLER_ANALOG_LEFT_Y);
        int rightX = master.get_analog(pros::E_CONTROLLER_ANALOG_RIGHT_X);
        chassis.arcade(leftY, rightX);
        pros::delay(20);
    }
}
`,
    okapilib: `#include "main.h"
#include "okapi/api.hpp"
using namespace okapi;

// ── Chassis (replace port numbers with yours) ─────────────────────────────────
auto chassis = ChassisControllerBuilder()
    .withMotors({1, 2}, {-3, -4})
    .withDimensions(AbstractMotor::gearset::blue, {{3.25_in, 12.5_in}, imev5BlueTPR})
    .build();

void initialize() {}
void disabled() {}
void competition_initialize() {}

void autonomous() {
    chassis->moveDistance(24_in);
    chassis->turnAngle(90_deg);
}

void opcontrol() {
    while (true) {
        chassis->getModel()->arcade(
            master.get_analog(ANALOG_LEFT_Y) / 127.0,
            master.get_analog(ANALOG_RIGHT_X) / 127.0
        );
        pros::delay(20);
    }
}
`,
    'ez-template': `#include "main.h"
#include "EZ-Template/drive/drive.hpp"

// ── EZ-Template Drive (replace port numbers with yours) ───────────────────────
Drive chassis (
    {1, 2, 3},    // Left motors  (negative = reversed)
    {-4, -5, -6}, // Right motors
    7,            // IMU port
    3.25,         // Wheel diameter (in)
    360           // Cartridge RPM
);

void initialize() {
    ez::as::initialize();
    chassis.set_drive_brake(MOTOR_BRAKE_HOLD);
}

void disabled() {}
void competition_initialize() {}

void autonomous() {
    chassis.set_drive_pid(24, 110);
    chassis.wait_drive();
    chassis.set_turn_pid(90, 90);
    chassis.wait_drive();
}

void opcontrol() {
    while (true) {
        chassis.arcade_standard(ez::SPLIT);
        pros::delay(ez::util::DELAY_TIME);
    }
}
`,
  };

  const mainCpp = mains[library] || mains.blank;
  const projPros = JSON.stringify({ version: '0.1.0', target: 'v5', description: name, templates: [] }, null, 2);

  fs.writeFileSync(path.join(projectPath, 'src', 'main.cpp'),    mainCpp);
  fs.writeFileSync(path.join(projectPath, 'include', 'main.h'),  mainH);
  fs.writeFileSync(path.join(projectPath, 'project.pros'),       projPros);
}

// ─── IPC: SETTINGS ────────────────────────────────────────────────────────────

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

function _loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); }
  catch { return {}; }
}

ipcMain.handle('settings:get', () => _loadSettings());

ipcMain.handle('settings:set', (_event, settings) => {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
  return true;
});

ipcMain.handle('ide:browseExe', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(win, {
    title: 'Select PROS CLI Executable',
    filters: [
      { name: 'Executables', extensions: ['exe', 'cmd', 'bat'] },
      { name: 'All Files',   extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('ide:browseDir', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0];
  const result = await dialog.showOpenDialog(win, {
    title: 'Select Toolchain bin/ Directory',
    properties: ['openDirectory'],
  });
  return result.filePaths[0] || null;
});

ipcMain.handle('ide:mkdir', async (_event, dirPath) => {
  try { fs.mkdirSync(dirPath, { recursive: true }); return true; }
  catch { return false; }
});

// ─── TELEMETRY ────────────────────────────────────────────────────────────────

const SESSIONS_DIR = path.join(app.getPath('userData'), 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

ipcMain.handle('sim:saveTelemetry', async (_event, session) => {
  try {
    const fname = `session_${session.id}_${session.mode}.json`;
    fs.writeFileSync(path.join(SESSIONS_DIR, fname), JSON.stringify(session), 'utf8');
    return true;
  } catch { return false; }
});

ipcMain.handle('sim:listSessions', async () => {
  try {
    return fs.readdirSync(SESSIONS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const raw = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
        return { file: f, id: raw.id, date: raw.date, mode: raw.mode, frameCount: raw.frames?.length || 0 };
      })
      .sort((a, b) => b.id - a.id);
  } catch { return []; }
});

ipcMain.handle('sim:loadSession', async (_event, file) => {
  try { return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8')); }
  catch { return null; }
});
