// Nexus Web Stub — browser polyfills for Electron APIs.
// Runs only when NOT inside Electron (preload.js sets window.electronAPI first).
if (!window.electronAPI) {

  // ── Compile-server config ────────────────────────────────────────────────────
  // Set via Settings panel or localStorage key 'nexus_compile_server'.
  // Falls back to a local dev server if not configured.
  const _DEFAULT_SERVER = 'https://nexus-compile-server-production.up.railway.app';

  function _serverUrl() {
    return (localStorage.getItem('nexus_compile_server') || _DEFAULT_SERVER).replace(/\/$/, '');
  }

  // Each browser session gets a persistent ID so projects survive page reloads.
  function _sessionId() {
    let id = localStorage.getItem('nexus_session_id');
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
               .map(b => b.toString(16).padStart(2,'0')).join('');
      localStorage.setItem('nexus_session_id', id);
    }
    return id;
  }

  // Absolute server path → relative path the server understands.
  // Paths look like "sessionId/projects/mybot/src/main.cpp".
  function _relPath(p) {
    if (!p) return '';
    return p.startsWith(_sessionId() + '/') ? p.slice(_sessionId().length + 1) : p;
  }

  // Prefix server paths so code.js can tell them apart from local paths.
  function _srvPath(rel) { return _sessionId() + '/' + rel; }

  async function _api(method, route, body) {
    const url = _serverUrl();
    if (!url) throw new Error('Compile server not configured. Go to ⚙ Settings to set the URL.');
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify({ sessionId: _sessionId(), ...body });
    const r = await fetch(url + route, opts);
    if (!r.ok) throw new Error(`Server error ${r.status}: ${await r.text()}`);
    return r;
  }

  // ── Output callback (mirrors Electron IPC events) ─────────────────────────────
  let _ideOutputCb = null;

  // ── File picker helper ────────────────────────────────────────────────────────
  const _fileCache = {};
  const _pickFile = (exts, readAs) => new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (exts && exts.length) inp.accept = exts.map(e => '.' + e).join(',');
    inp.onchange = () => {
      const file = inp.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = ev => resolve(ev.target.result);
      if (readAs === 'text') reader.readAsText(file);
      else reader.readAsDataURL(file);
    };
    inp.click();
  });

  // localStorage telemetry
  const SESS_IDX = 'nexus_sessions_v1';
  const sessKey  = id => 'nexus_sess_' + id;

  // ── electronAPI stub ─────────────────────────────────────────────────────────
  window.electronAPI = {
    isElectron: false,

    // ── File access ────────────────────────────────────────────────────────────
    openFileDialog: async (filters) => {
      const exts = (filters || []).flatMap(f => f.extensions || []);
      const dataUrl = await _pickFile(exts, 'dataURL');
      if (!dataUrl) return null;
      const key = 'web://uploaded_' + Date.now();
      _fileCache[key] = dataUrl;
      return key;
    },
    getFileUrl: async (p) => _fileCache[p] || p,

    // ── yt-dlp (unavailable) ───────────────────────────────────────────────────
    checkYtdlp:          async () => false,
    downloadClip:        async () => ({ error: 'yt-dlp is not available in the web version' }),
    onDownloadProgress:  () => {},
    removeDownloadListeners: () => {},

    // ── Google OAuth ───────────────────────────────────────────────────────────
    googleAuth: async (url) => {
      const win = window.open(url, 'gauth', 'width=500,height=620');
      return new Promise(resolve => {
        const poll = setInterval(() => {
          try {
            const hash = win.location.hash;
            if (hash && hash.includes('access_token')) {
              const token = new URLSearchParams(hash.slice(1)).get('access_token');
              clearInterval(poll); win.close(); resolve(token);
            }
          } catch {}
          if (win.closed) { clearInterval(poll); resolve(null); }
        }, 300);
      });
    },

    onUpdateStatus: () => {},

    // ── STL library ───────────────────────────────────────────────────────────
    stlSave:   async () => null,
    stlList:   async () => [],
    stlDelete: async () => null,
    stlRead:   async (p) => {
      const d = _fileCache[p];
      if (!d) return null;
      try { return atob(d.split(',')[1]); } catch { return null; }
    },
    snapshotSave: async () => null,

    // ── Sim config ────────────────────────────────────────────────────────────
    simLoadConfig: async () => {
      const text = await _pickFile(['json'], 'text');
      if (!text) return null;
      try { return JSON.parse(text); } catch { return null; }
    },
    simSaveConfig:   async () => null,
    simPickFieldObj: async () => null,
    simGetFieldPath: async () => null,
    openExternal: (url) => window.open(url, '_blank'),

    // ── Telemetry via localStorage ─────────────────────────────────────────────
    simSaveTelemetry: async (session) => {
      try {
        const index = JSON.parse(localStorage.getItem(SESS_IDX) || '[]');
        index.push({ file: String(session.id), mode: session.mode, ts: session.id });
        localStorage.setItem(SESS_IDX, JSON.stringify(index.slice(-20)));
        localStorage.setItem(sessKey(session.id), JSON.stringify(session));
        return { ok: true };
      } catch { return { ok: false }; }
    },
    simListSessions: async () => {
      try { return JSON.parse(localStorage.getItem(SESS_IDX) || '[]'); }
      catch { return []; }
    },
    simLoadSession: async (file) => {
      try { return JSON.parse(localStorage.getItem(sessKey(file)) || 'null'); }
      catch { return null; }
    },

    // ── Code IDE — proxied through compile server ──────────────────────────────

    ideCheckPros: async () => {
      try { return (await (await _api('GET', '/ping')).json()).pros || null; }
      catch { return null; }
    },

    ideCheckToolchain: async () => {
      try { return (await (await _api('GET', '/ping')).json()).gcc || null; }
      catch { return null; }
    },

    // "Projects dir" is a virtual prefix — code.js stores it and passes it back
    // to ideListDir / ideNewProject. We use the session ID as the root.
    ideGetProjectsDir: async () => _srvPath('projects'),

    // Folder picker: show the project list and let user pick (or just return projects dir)
    idePickFolder: async () => {
      const projects = await window.electronAPI.ideGetProjectsDir();
      return projects;
    },

    ideListDir: async (dirPath) => {
      try {
        const r = await _api('GET', `/ls?sessionId=${_sessionId()}&path=${encodeURIComponent(_relPath(dirPath))}`);
        const entries = await r.json();
        return entries.map(e => ({
          name: e.name,
          path: _srvPath(e.path),
          isDir: e.isDir,
        }));
      } catch { return []; }
    },

    ideReadFile: async (filePath) => {
      try {
        const r = await _api('GET', `/read?sessionId=${_sessionId()}&path=${encodeURIComponent(_relPath(filePath))}`);
        return await r.text();
      } catch { return null; }
    },

    ideWriteFile: async (filePath, content) => {
      try {
        await _api('POST', '/write', { path: _relPath(filePath), content });
        return true;
      } catch { return false; }
    },

    ideNewProject: async ({ name, location }) => {
      try {
        const r  = await _api('POST', '/projects/new', { name });
        const j  = await r.json();
        return {
          ok:          j.ok,
          projectPath: j.ok ? _srvPath(j.projectPath) : null,
          output:      j.output || '',
        };
      } catch (e) {
        return { ok: false, projectPath: null, output: e.message };
      }
    },

    ideRunCommand: async ({ cmd, args, cwd }) => {
      const url = _serverUrl();
      if (!url) {
        const msg = 'Compile server not configured — set URL in ⚙ Settings → Compile Server.\n';
        if (_ideOutputCb) _ideOutputCb({ text: msg, type: 'err' });
        return -1;
      }

      const body = JSON.stringify({ sessionId: _sessionId(), cmd, args, cwd: _relPath(cwd) });
      let resp;
      try {
        resp = await fetch(url + '/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
      } catch (e) {
        if (_ideOutputCb) _ideOutputCb({ text: 'Could not reach compile server: ' + e.message + '\n', type: 'err' });
        return -1;
      }

      // Read the SSE stream and forward events to the output callback
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '', exitCode = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const evt of events) {
          const line = evt.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          try {
            const { type, data } = JSON.parse(line.slice(5));
            if ((type === 'out' || type === 'err') && _ideOutputCb)
              _ideOutputCb({ text: data, type });
            if (type === 'exit') exitCode = data ?? 0;
          } catch {}
        }
      }
      return exitCode;
    },

    ideStopCommand: async () => {
      try { await _api('POST', '/stop', {}); } catch {}
    },

    onIdeOutput:             (cb) => { _ideOutputCb = cb; },
    removeIdeOutputListeners: () => { _ideOutputCb = null; },

    onProsStatus: () => {},

    ideInstallLibrary: async ({ library, projectPath }) => {
      try {
        const r = await _api('POST', '/library/add', { library, projectPath: _relPath(projectPath) });
        return await r.json();
      } catch (e) { return { ok: false, output: e.message }; }
    },

    // Browse dialogs not available in browser — return null gracefully
    ideBrowseExe: async () => null,
    ideBrowseDir: async () => null,
    ideMkdir: async (dirPath) => {
      try { await _api('POST', '/mkdir', { path: _relPath(dirPath) }); return true; }
      catch { return false; }
    },

    // Settings stored in localStorage
    settingsGet: async () => {
      try { return JSON.parse(localStorage.getItem('nexus_settings') || '{}'); }
      catch { return {}; }
    },
    settingsSet: async (s) => {
      try {
        localStorage.setItem('nexus_settings', JSON.stringify(s));
        if (s.compileServerUrl !== undefined)
          localStorage.setItem('nexus_compile_server', s.compileServerUrl || '');
        return true;
      } catch { return false; }
    },
  };
}
