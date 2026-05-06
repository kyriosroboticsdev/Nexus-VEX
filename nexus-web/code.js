// ─── CODE IDE ────────────────────────────────────────────────────────────────

const IDE = {
  projectPath: null,
  projectName: null,
  openTabs: [],
  activeTabPath: null,
  editor: null,
  monacoReady: false,
  prosAvailable: null,
};

let _ideInitStarted = false;

// ─── SUBTAB SWITCHING ─────────────────────────────────────────────────────────

function openIDE() {
  document.getElementById('idePage').style.display = 'flex';
  ideInit();
}

function closeIDE() {
  document.getElementById('idePage').style.display = 'none';
  const hp = document.getElementById('homePage');
  if (hp) hp.style.display = 'flex';
}

function pidSendToIDE() {
  const kP = (typeof SIM !== 'undefined' && SIM.pid) ? SIM.pid.kP.toFixed(2) : parseFloat(document.getElementById('simKp')?.value || 1.5).toFixed(2);
  const kI = (typeof SIM !== 'undefined' && SIM.pid) ? SIM.pid.kI.toFixed(2) : parseFloat(document.getElementById('simKi')?.value || 0.01).toFixed(2);
  const kD = (typeof SIM !== 'undefined' && SIM.pid) ? SIM.pid.kD.toFixed(2) : parseFloat(document.getElementById('simKd')?.value || 0.8).toFixed(2);

  const snippet =
    `// PID constants tuned in Nexus Simulator\n` +
    `float kP = ${kP}f;\n` +
    `float kI = ${kI}f;\n` +
    `float kD = ${kD}f;\n`;

  openIDE();

  const tryInsert = (attempts = 0) => {
    if (IDE.editor && typeof monaco !== 'undefined') {
      const pos = IDE.editor.getPosition() || { lineNumber: 1, column: 1 };
      IDE.editor.executeEdits('pid-export', [{
        range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        text: snippet,
      }]);
      IDE.editor.focus();
      ideAppendOutput(`PID constants inserted at cursor — kP=${kP}  kI=${kI}  kD=${kD}\n`, 'success');
    } else if (attempts < 20) {
      setTimeout(() => tryInsert(attempts + 1), 200);
    } else {
      navigator.clipboard.writeText(snippet).catch(() => {});
      ideAppendOutput(`No file open — PID constants copied to clipboard:\n${snippet}`, 'info');
    }
  };
  tryInsert();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

const _NOISE_PATTERNS = [
  /bash\.exe: warning: could not find \/tmp/,
  /UserWarning: pkg_resources is deprecated/,
  /setuptools\.pypa\.io.*pkg_resources/,
  /The pkg_resources package is slated/,
  /Refrain from using this package or pin/,
  /^\s*import pkg_resources\s*$/,
];

function _filterBuildOutput(text) {
  const lines = text.split('\n');
  const kept = lines.filter(line => !_NOISE_PATTERNS.some(re => re.test(line)));
  const result = kept.join('\n');
  // Collapse runs of blank lines to at most one
  return result.replace(/\n{3,}/g, '\n\n');
}

async function ideInit() {
  if (_ideInitStarted) return;
  _ideInitStarted = true;

  ideAppendOutput('Initializing IDE…\n', 'info');

  if (window.electronAPI) {
    const [ver, gcc] = await Promise.all([
      window.electronAPI.ideCheckPros(),
      window.electronAPI.ideCheckToolchain(),
    ]);

    IDE.prosAvailable = !!ver;

    const prosEl = document.getElementById('ideProsStatus');
    if (prosEl) {
      prosEl.textContent = ver ? `PROS ${ver}` : '⚠ Not installed';
      prosEl.style.color = ver ? 'var(--gold)' : '#f87171';
    }

    const gccEl = document.getElementById('ideToolchainStatus');
    if (gccEl) {
      gccEl.textContent = gcc ? `GCC ${gcc}` : '⚠ Missing';
      gccEl.style.color = gcc ? 'var(--gold)' : '#f87171';
    }

    if (!gcc) {
      ideAppendOutput(
        '⚠ ARM toolchain (arm-none-eabi-gcc) not found — pros make will fail.\n\n' +
        'To fix, install the PROS toolchain:\n' +
        '  Option 1 (recommended): Re-install PROS using the official installer,\n' +
        '    which bundles the CLI + toolchain together:\n' +
        '    https://pros.cs.purdue.edu/v5/getting-started/windows.html\n\n' +
        '  Option 2: Download arm-none-eabi-gcc from ARM or PROS GitHub releases,\n' +
        '    then point Nexus to it via ⚙ Settings → Toolchain bin/ Directory.\n\n',
        'error'
      );
    }

    window.electronAPI.onIdeOutput(data => {
      const filtered = _filterBuildOutput(data.text);
      if (filtered) ideAppendOutput(filtered, data.type);
    });
  }

  _ideLoadMonaco();
}

function _ideLoadMonaco() {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js';
  s.onload = () => {
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
    require(['vs/editor/editor.main'], _ideCreateEditor);
  };
  s.onerror = () => ideAppendOutput('Failed to load Monaco — check internet connection.\n', 'error');
  document.head.appendChild(s);
}

function _ideCreateEditor() {
  const mount = document.getElementById('ideEditorMount');
  if (!mount) return;

  IDE.editor = monaco.editor.create(mount, {
    theme: 'vs-dark',
    language: 'cpp',
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
    wordWrap: 'off',
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    folding: true,
    lineNumbers: 'on',
    glyphMargin: false,
    renderLineHighlight: 'all',
    suggestOnTriggerCharacters: true,
  });

  IDE.monacoReady = true;

  IDE.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, ideSaveActive);
  IDE.editor.onDidChangeModelContent(() => {
    const tab = IDE.openTabs.find(t => t.path === IDE.activeTabPath);
    if (tab && !tab.modified) { tab.modified = true; ideRenderTabBar(); }
  });

  ideAppendOutput('Monaco editor ready. Ctrl+S to save.\n', 'info');
  if (IDE.projectPath) ideBuildFileTree();
}

// ─── FILE TREE ────────────────────────────────────────────────────────────────

async function ideBuildFileTree() {
  const container = document.getElementById('ideFileTree');
  if (!container) return;
  container.innerHTML = '';

  if (!IDE.projectPath) {
    container.innerHTML = `<div style="padding:20px 12px;font-size:12px;color:var(--t3);text-align:center;line-height:2;">
      No project open.<br>
      <button class="btn-g" style="font-size:11px;margin-top:8px;" onclick="ideShowNewProject()">+ New Project</button><br>
      <button class="btn-o" style="font-size:11px;margin-top:6px;" onclick="ideOpenProject()">📂 Open Folder</button>
    </div>`;
    return;
  }

  const hdr = document.createElement('div');
  hdr.style.cssText = 'padding:8px 10px 4px;font-size:11px;font-weight:700;color:var(--gold);font-family:var(--fd);text-transform:uppercase;letter-spacing:0.1em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default;border-bottom:1px solid var(--b1);margin-bottom:4px;';
  hdr.textContent = IDE.projectName;
  hdr.title = IDE.projectPath;
  container.appendChild(hdr);

  await ideRenderDir(IDE.projectPath, container, 0);
}

async function ideRenderDir(dirPath, container, depth) {
  if (!window.electronAPI) return;
  const entries = await window.electronAPI.ideListDir(dirPath);

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'ide-tree-row';
    row.dataset.path = entry.path;

    const pad = 10 + depth * 14;
    row.style.cssText = `display:flex;align-items:center;gap:5px;padding:3px 8px 3px ${pad}px;cursor:pointer;font-size:12px;color:var(--t2);user-select:none;border-radius:4px;margin:1px 4px;transition:background 0.1s;`;

    const iconEl = document.createElement('span');
    iconEl.style.cssText = 'font-size:12px;flex-shrink:0;width:16px;text-align:center;';
    iconEl.textContent = entry.isDir ? '▶' : '';

    const typeIcon = document.createElement('span');
    typeIcon.style.cssText = 'font-size:12px;flex-shrink:0;';
    typeIcon.textContent = entry.isDir ? '📁' : ideFileIcon(entry.name);

    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    nameEl.textContent = entry.name;

    row.appendChild(iconEl);
    row.appendChild(typeIcon);
    row.appendChild(nameEl);

    row.addEventListener('mouseenter', () => { if (!row.dataset.active) row.style.background = 'rgba(255,255,255,0.04)'; });
    row.addEventListener('mouseleave', () => { if (!row.dataset.active) row.style.background = ''; });

    if (entry.isDir) {
      let expanded = false;
      let childContainer = null;
      row.addEventListener('click', async () => {
        expanded = !expanded;
        iconEl.textContent = expanded ? '▼' : '▶';
        typeIcon.textContent = expanded ? '📂' : '📁';
        if (expanded) {
          childContainer = document.createElement('div');
          row.after(childContainer);
          await ideRenderDir(entry.path, childContainer, depth + 1);
        } else {
          if (childContainer) { childContainer.remove(); childContainer = null; }
        }
      });
    } else {
      row.addEventListener('click', () => ideOpenFile(entry.path));
    }

    container.appendChild(row);
  }
}

function ideFileIcon(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.cpp') || n.endsWith('.cc') || n.endsWith('.cxx')) return '📄';
  if (n.endsWith('.h')   || n.endsWith('.hpp') || n.endsWith('.hxx')) return '📋';
  if (n.endsWith('.c')) return '📄';
  if (n.endsWith('.json') || n.endsWith('.pros')) return '⚙';
  if (n === 'makefile' || n.endsWith('.mk')) return '🔨';
  if (n.endsWith('.md') || n.endsWith('.txt')) return '📝';
  if (n.endsWith('.py')) return '🐍';
  return '📄';
}

function ideHighlightTreeRow(filePath) {
  document.querySelectorAll('.ide-tree-row').forEach(r => {
    const active = r.dataset.path === filePath;
    r.dataset.active = active ? '1' : '';
    r.style.background = active ? 'rgba(168,85,247,0.15)' : '';
    r.style.color = active ? 'var(--t1)' : 'var(--t2)';
  });
}

// ─── FILE TABS ────────────────────────────────────────────────────────────────

async function ideOpenFile(filePath) {
  const existing = IDE.openTabs.find(t => t.path === filePath);
  if (existing) { ideActivateTab(filePath); return; }

  if (!window.electronAPI) return;
  const content = await window.electronAPI.ideReadFile(filePath);
  if (content === null) { ideAppendOutput(`Cannot read: ${filePath}\n`, 'error'); return; }

  const name = filePath.replace(/\\/g, '/').split('/').pop();
  const lang = ideDetectLang(name);

  let model = null;
  if (IDE.monacoReady) {
    const uri = monaco.Uri.parse('file:///' + filePath.replace(/\\/g, '/').replace(/^\//, ''));
    model = monaco.editor.getModel(uri) || monaco.editor.createModel(content, lang, uri);
  }

  IDE.openTabs.push({ path: filePath, name, model, modified: false });
  ideActivateTab(filePath);
  ideRenderTabBar();
}

function ideActivateTab(filePath) {
  IDE.activeTabPath = filePath;
  const tab = IDE.openTabs.find(t => t.path === filePath);

  const welcome = document.getElementById('ideWelcome');
  const mount   = document.getElementById('ideEditorMount');

  if (IDE.monacoReady && IDE.editor && tab?.model) {
    IDE.editor.setModel(tab.model);
    if (welcome) welcome.style.display = 'none';
    if (mount)   mount.style.display   = 'block';
    IDE.editor.focus();
  }

  ideRenderTabBar();
  ideHighlightTreeRow(filePath);
}

function ideCloseTab(filePath, e) {
  if (e) e.stopPropagation();
  const idx = IDE.openTabs.findIndex(t => t.path === filePath);
  if (idx === -1) return;

  const tab = IDE.openTabs[idx];
  if (tab.modified && !confirm(`Save "${tab.name}" before closing?`)) {
    // discard
  } else if (tab.modified) {
    ideSaveFile(filePath);
  }

  if (tab.model) tab.model.dispose();
  IDE.openTabs.splice(idx, 1);

  if (IDE.activeTabPath === filePath) {
    const next = IDE.openTabs[Math.min(idx, IDE.openTabs.length - 1)];
    if (next) {
      ideActivateTab(next.path);
    } else {
      IDE.activeTabPath = null;
      if (IDE.monacoReady && IDE.editor) IDE.editor.setModel(null);
      const welcome = document.getElementById('ideWelcome');
      const mount   = document.getElementById('ideEditorMount');
      if (welcome) welcome.style.display = 'flex';
      if (mount)   mount.style.display   = 'none';
    }
  }

  ideRenderTabBar();
}

function ideRenderTabBar() {
  const bar = document.getElementById('ideTabBar');
  if (!bar) return;
  bar.innerHTML = '';

  IDE.openTabs.forEach(tab => {
    const isActive = tab.path === IDE.activeTabPath;
    const el = document.createElement('div');
    el.style.cssText = [
      'display:flex;align-items:center;gap:6px;padding:0 10px 0 14px;height:34px;',
      'font-size:12px;cursor:pointer;white-space:nowrap;border-right:1px solid var(--b1);flex-shrink:0;',
      isActive
        ? 'background:var(--s3);color:var(--t1);border-bottom:2px solid var(--gold);'
        : 'background:var(--s1);color:var(--t3);',
    ].join('');
    el.addEventListener('click', () => ideActivateTab(tab.path));

    const nm = document.createElement('span');
    nm.textContent = (tab.modified ? '● ' : '') + tab.name;

    const x = document.createElement('span');
    x.textContent = '×';
    x.style.cssText = 'font-size:16px;line-height:1;opacity:0.4;padding:0 2px;border-radius:3px;margin-left:2px;';
    x.addEventListener('mouseenter', () => { x.style.opacity = '1'; x.style.background = 'rgba(255,255,255,0.1)'; });
    x.addEventListener('mouseleave', () => { x.style.opacity = '0.4'; x.style.background = ''; });
    x.addEventListener('click', ev => ideCloseTab(tab.path, ev));

    el.appendChild(nm);
    el.appendChild(x);
    bar.appendChild(el);
  });
}

function ideDetectLang(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.cpp') || n.endsWith('.cc') || n.endsWith('.cxx') ||
      n.endsWith('.h')   || n.endsWith('.hpp') || n.endsWith('.hxx')) return 'cpp';
  if (n.endsWith('.c')) return 'c';
  if (n.endsWith('.json') || n.endsWith('.pros')) return 'json';
  if (n === 'makefile' || n.endsWith('.mk')) return 'makefile';
  if (n.endsWith('.py')) return 'python';
  if (n.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

// ─── SAVE ─────────────────────────────────────────────────────────────────────

async function ideSaveActive() {
  if (IDE.activeTabPath) await ideSaveFile(IDE.activeTabPath);
}

async function ideSaveFile(filePath) {
  const tab = IDE.openTabs.find(t => t.path === filePath);
  if (!tab || !tab.model || !window.electronAPI) return;
  const content = tab.model.getValue();
  const ok = await window.electronAPI.ideWriteFile(filePath, content);
  if (ok) {
    tab.modified = false;
    ideRenderTabBar();
    ideAppendOutput(`Saved ${tab.name}\n`, 'info');
  }
}

async function ideSaveAll() {
  for (const tab of IDE.openTabs) {
    if (tab.modified) await ideSaveFile(tab.path);
  }
}

// ─── PROJECT MANAGEMENT ───────────────────────────────────────────────────────

function ideShowNewProject() {
  document.getElementById('ideNewProjectModal').style.display = 'flex';
  const nameInput = document.getElementById('ideNewProjName');
  if (nameInput) { nameInput.value = ''; nameInput.focus(); }
}

function ideHideNewProject() {
  document.getElementById('ideNewProjectModal').style.display = 'none';
}

async function ideCreateProject() {
  const raw  = (document.getElementById('ideNewProjName').value || '').trim();
  const name = raw.replace(/[^a-zA-Z0-9_\-]/g, '_');
  if (!name) { alert('Enter a project name.'); return; }

  const lib = document.getElementById('ideNewProjLib').value;
  ideHideNewProject();
  ideClearOutput();
  ideAppendOutput(`Creating project "${name}" (${lib})…\n`, 'info');

  const projectsDir = await window.electronAPI.ideGetProjectsDir();
  const result = await window.electronAPI.ideNewProject({ name, location: projectsDir, library: lib });

  if (result && result.success) {
    ideAppendOutput(result.output + '\n', result.usedCLI ? 'stdout' : 'info');
    await ideLoadProject(result.path, name);
  } else {
    ideAppendOutput('Failed to create project.\n', 'error');
  }
}

async function ideOpenProject() {
  if (!window.electronAPI) return;
  const folderPath = await window.electronAPI.idePickFolder();
  if (!folderPath) return;
  const name = folderPath.replace(/\\/g, '/').split('/').pop();
  await ideLoadProject(folderPath, name);
}

async function ideLoadProject(folderPath, name) {
  IDE.projectPath = folderPath;
  IDE.projectName = name;

  for (const tab of IDE.openTabs) { if (tab.model) tab.model.dispose(); }
  IDE.openTabs = [];
  IDE.activeTabPath = null;
  ideRenderTabBar();

  const welcome = document.getElementById('ideWelcome');
  const mount   = document.getElementById('ideEditorMount');
  if (welcome) welcome.style.display = 'flex';
  if (mount)   mount.style.display   = 'none';

  await ideBuildFileTree();

  // Auto-open main.cpp if present
  if (window.electronAPI) {
    const sep     = folderPath.includes('/') ? '/' : '\\';
    const mainCpp = folderPath + sep + 'src' + sep + 'main.cpp';
    const content = await window.electronAPI.ideReadFile(mainCpp);
    if (content !== null) await ideOpenFile(mainCpp);
  }

  ideAppendOutput(`Opened: ${name}\n`, 'info');
}

// ─── BUILD / UPLOAD ───────────────────────────────────────────────────────────

async function ideInstallLemLib() {
  if (!IDE.projectPath) { ideAppendOutput('No project open.\n', 'error'); return; }
  ideClearOutput();
  ideAppendOutput('Installing LemLib — this may take a moment…\n', 'info');
  ideAppendOutput('> pros conductor add-depot lemlib\n', 'cmd');
  ideAppendOutput('> pros conductor fetch LemLib\n', 'cmd');
  ideAppendOutput('> pros conductor apply LemLib\n\n', 'cmd');
  const result = await window.electronAPI.ideInstallLibrary({ library: 'lemlib', projectPath: IDE.projectPath });
  ideAppendOutput(result.success ? '\nLemLib installed successfully! Run Build to compile.\n' : '\nFailed to install LemLib. Check output above.\n',
    result.success ? 'success' : 'error');
}

async function ideBuild() {
  if (!IDE.projectPath) { ideAppendOutput('No project open.\n', 'error'); return; }
  await ideSaveAll();
  ideClearOutput();
  ideAppendOutput('> pros make\n', 'cmd');
  const code = await window.electronAPI.ideRunCommand({ cmd: 'pros', args: ['make'], cwd: IDE.projectPath });
  ideAppendOutput(`\nProcess exited with code ${code}\n`, code === 0 ? 'success' : 'error');
}

async function ideUpload() {
  if (!IDE.projectPath) { ideAppendOutput('No project open.\n', 'error'); return; }
  await ideSaveAll();
  ideClearOutput();
  ideAppendOutput('> pros upload\n', 'cmd');
  const code = await window.electronAPI.ideRunCommand({ cmd: 'pros', args: ['upload'], cwd: IDE.projectPath });
  ideAppendOutput(`\nProcess exited with code ${code}\n`, code === 0 ? 'success' : 'error');
}

async function ideBuildUpload() {
  if (!IDE.projectPath) { ideAppendOutput('No project open.\n', 'error'); return; }
  await ideSaveAll();
  ideClearOutput();
  ideAppendOutput('> pros make\n', 'cmd');
  const buildCode = await window.electronAPI.ideRunCommand({ cmd: 'pros', args: ['make'], cwd: IDE.projectPath });
  if (buildCode !== 0) {
    ideAppendOutput(`\nBuild failed (code ${buildCode}) — upload skipped.\n`, 'error');
    return;
  }
  ideAppendOutput('\n> pros upload\n', 'cmd');
  const uploadCode = await window.electronAPI.ideRunCommand({ cmd: 'pros', args: ['upload'], cwd: IDE.projectPath });
  ideAppendOutput(`\nProcess exited with code ${uploadCode}\n`, uploadCode === 0 ? 'success' : 'error');
}

// ─── OUTPUT PANEL ─────────────────────────────────────────────────────────────

function ideAppendOutput(text, type) {
  const el = document.getElementById('ideOutputContent');
  if (!el) return;
  const colors = { stdout: 'var(--t1)', stderr: '#f87171', error: '#f87171', info: 'var(--t3)', cmd: 'var(--gold)', success: '#4ade80' };
  const span = document.createElement('span');
  span.style.color = colors[type] || 'var(--t1)';
  if (type === 'cmd') span.style.fontWeight = '700';
  span.textContent = text;
  el.appendChild(span);
  el.scrollTop = el.scrollHeight;
}

function ideClearOutput() {
  const el = document.getElementById('ideOutputContent');
  if (el) el.innerHTML = '';
}

let _ideOutputCollapsed = false;
function ideToggleOutput() {
  _ideOutputCollapsed = !_ideOutputCollapsed;
  const panel = document.getElementById('ideOutputPanel');
  const btn   = document.getElementById('ideOutputToggleBtn');
  if (panel) panel.style.height = _ideOutputCollapsed ? '32px' : '180px';
  if (btn)   btn.textContent    = _ideOutputCollapsed ? '▲ Output' : '▼ Output';
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

let _ideSettings = {};

async function ideShowSettings() {
  if (window.electronAPI) _ideSettings = (await window.electronAPI.settingsGet()) || {};
  document.getElementById('ideSetProsPath').value      = _ideSettings.prosCliPath      || '';
  document.getElementById('ideSetToolchainPath').value = _ideSettings.toolchainBinPath || '';
  // Populate compile server URL (web/Chromebook)
  const serverInput = document.getElementById('ideSetServerUrl');
  if (serverInput) serverInput.value = localStorage.getItem('nexus_compile_server') || '';
  _ideDriveUpdateUI();
  document.getElementById('ideSettingsModal').style.display = 'flex';
}

function ideHideSettings() {
  document.getElementById('ideSettingsModal').style.display = 'none';
}

async function ideSaveSettings() {
  _ideSettings.prosCliPath      = document.getElementById('ideSetProsPath').value.trim();
  _ideSettings.toolchainBinPath = document.getElementById('ideSetToolchainPath').value.trim();
  // Save compile server URL
  const serverInput = document.getElementById('ideSetServerUrl');
  if (serverInput) {
    const url = serverInput.value.trim().replace(/\/$/, '');
    localStorage.setItem('nexus_compile_server', url);
    _ideSettings.compileServerUrl = url;
  }
  if (window.electronAPI) await window.electronAPI.settingsSet(_ideSettings);
  ideHideSettings();
  showToast('Settings saved.', 2000);
  const el = document.getElementById('ideProsStatus');
  if (el && _ideSettings.prosCliPath) { el.textContent = 'Custom path set'; el.style.color = 'var(--gold)'; }
}

async function ideTestServer() {
  const input  = document.getElementById('ideSetServerUrl');
  const result = document.getElementById('ideServerTestResult');
  const url    = (input?.value || '').trim().replace(/\/$/, '');
  if (!url) { if (result) result.textContent = 'Enter a URL first.'; return; }
  if (result) result.textContent = 'Testing…';
  try {
    const r = await fetch(url + '/ping');
    const j = await r.json();
    if (result) {
      result.style.color = '#4ade80';
      result.textContent = `Connected — PROS ${j.pros || '?'}, GCC ${j.gcc || '?'}`;
    }
  } catch (e) {
    if (result) { result.style.color = '#f87171'; result.textContent = 'Could not reach server: ' + e.message; }
  }
}

async function ideBrowseProsExe() {
  if (!window.electronAPI) return;
  const p = await window.electronAPI.ideBrowseExe();
  if (p) document.getElementById('ideSetProsPath').value = p;
}

async function ideBrowseToolchainDir() {
  if (!window.electronAPI) return;
  const p = await window.electronAPI.ideBrowseDir();
  if (p) document.getElementById('ideSetToolchainPath').value = p;
}

async function ideTestProsPath() {
  const p = document.getElementById('ideSetProsPath').value.trim() || 'pros';
  ideHideSettings();
  ideClearOutput();
  ideAppendOutput(`Testing: ${p} --version\n`, 'cmd');
  const code = await window.electronAPI.ideRunCommand({ cmd: p, args: ['--version'], cwd: undefined });
  ideAppendOutput(code === 0 ? 'PROS CLI is working!\n' : 'Failed — check the path.\n', code === 0 ? 'success' : 'error');
}

// ─── GOOGLE DRIVE SYNC ────────────────────────────────────────────────────────

const DRIVE = { token: null, user: null, rootFolderId: null };
const _DRIVE_LS_KEY = 'nexus_drive_v1';
const _GID = '937251908005-hvco8m4dpidqiuo09er1tec3p14426au.apps.googleusercontent.com';

// Restore session from localStorage
(function () {
  try {
    const s = JSON.parse(localStorage.getItem(_DRIVE_LS_KEY) || '{}');
    if (s.token) { DRIVE.token = s.token; DRIVE.user = s.user; DRIVE.rootFolderId = s.rootFolderId || null; }
  } catch {}
})();

function _drivePersist() {
  localStorage.setItem(_DRIVE_LS_KEY, JSON.stringify({ token: DRIVE.token, user: DRIVE.user, rootFolderId: DRIVE.rootFolderId }));
}

async function driveSignIn() {
  const p = new URLSearchParams({
    client_id: _GID,
    redirect_uri: 'https://vexscout.vercel.app/',
    response_type: 'token',
    scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
    prompt: 'select_account',
  });
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
  try {
    const token = await window.electronAPI.googleAuth(authUrl);
    DRIVE.token = token;
    DRIVE.rootFolderId = null;
    const res  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } });
    const u    = await res.json();
    DRIVE.user = { email: u.email, name: u.name };
    _drivePersist();
    _ideDriveUpdateUI();
    showToast('Connected to Google Drive ☁', 3000);
  } catch (e) {
    if (e.message !== 'closed') showToast('Drive sign-in failed: ' + e.message, 4000);
  }
}

function driveSignOut() {
  DRIVE.token = null; DRIVE.user = null; DRIVE.rootFolderId = null;
  localStorage.removeItem(_DRIVE_LS_KEY);
  _ideDriveUpdateUI();
  showToast('Disconnected from Drive.', 2000);
}

function _ideDriveUpdateUI() {
  const area = document.getElementById('ideSettingsDriveArea');
  if (!area) return;
  if (DRIVE.token && DRIVE.user) {
    area.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--s3);border-radius:8px;border:1px solid var(--b1);">
        <div style="font-size:24px;">☁</div>
        <div style="flex:1;">
          <div style="font-size:13px;color:var(--t1);font-weight:600;">${DRIVE.user.name}</div>
          <div style="font-size:11px;color:var(--t3);">${DRIVE.user.email}</div>
        </div>
        <button class="btn-o" style="font-size:11px;" onclick="driveSignOut()">Disconnect</button>
      </div>
      <div style="font-size:11px;color:var(--t3);">Projects sync to <strong style="color:var(--t2);">Nexus Projects/</strong> in your Drive — accessible from any device.</div>`;
  } else {
    area.innerHTML = `
      <button class="btn-o" style="font-size:13px;padding:9px 16px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;" onclick="driveSignIn()">
        <svg width="14" height="14" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Connect Google Drive
      </button>
      <div style="font-size:11px;color:var(--t3);text-align:center;">Sign in to sync projects across all your devices.</div>`;
  }
}

// ─── DRIVE API HELPERS ────────────────────────────────────────────────────────

async function _driveApi(method, endpoint, body, params) {
  const url = new URL('https://www.googleapis.com/drive/v3' + endpoint);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), {
    method,
    headers: { Authorization: 'Bearer ' + DRIVE.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { driveSignOut(); throw new Error('Drive session expired — reconnect in ⚙ Settings.'); }
  if (!res.ok) throw new Error(`Drive API error ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function _driveUpload(name, content, parentId, existingId) {
  const meta = existingId ? { name } : { name, parents: [parentId] };
  const boundary = 'nexus_' + Date.now();
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${content}\r\n--${boundary}--`;
  const url  = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const res = await fetch(url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { Authorization: 'Bearer ' + DRIVE.token, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error('Upload failed ' + res.status);
  return res.json();
}

async function _driveEnsureRoot() {
  if (DRIVE.rootFolderId) return DRIVE.rootFolderId;
  const res = await _driveApi('GET', '/files', undefined, {
    q: "name='Nexus Projects' and mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id)',
  });
  if (res.files?.length) {
    DRIVE.rootFolderId = res.files[0].id;
  } else {
    const f = await _driveApi('POST', '/files', { name: 'Nexus Projects', mimeType: 'application/vnd.google-apps.folder' });
    DRIVE.rootFolderId = f.id;
  }
  _drivePersist();
  return DRIVE.rootFolderId;
}

// ─── DRIVE: PUSH ─────────────────────────────────────────────────────────────

async function drivePushProject() {
  if (!DRIVE.token) { showToast('Connect Google Drive in ⚙ Settings first.', 3000); ideShowSettings(); return; }
  if (!IDE.projectPath) { showToast('No project open.', 2000); return; }
  await ideSaveAll();

  ideClearOutput();
  ideAppendOutput(`Pushing "${IDE.projectName}" to Drive…\n`, 'cmd');

  try {
    const rootId = await _driveEnsureRoot();

    // Find or create project folder in Drive
    const existingFolders = await _driveApi('GET', '/files', undefined, {
      q: `name='${IDE.projectName.replace(/'/g,"\\'")}' and '${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });
    let projFolderId;
    if (existingFolders.files?.length) {
      projFolderId = existingFolders.files[0].id;
    } else {
      const f = await _driveApi('POST', '/files', { name: IDE.projectName, mimeType: 'application/vnd.google-apps.folder', parents: [rootId] });
      projFolderId = f.id;
    }

    // List existing Drive files for update detection
    const existingFiles = await _driveApi('GET', '/files', undefined, {
      q: `'${projFolderId}' in parents and trashed=false`,
      fields: 'files(id,name)',
    });
    const existingMap = Object.fromEntries((existingFiles.files || []).map(f => [f.name, f.id]));

    // Walk local project and upload
    const files = await _collectProjectFiles(IDE.projectPath);
    for (const { name, content } of files) {
      await _driveUpload(name, content, projFolderId, existingMap[name]);
      ideAppendOutput(`  ✓ ${name}\n`, 'success');
    }

    ideAppendOutput(`\n☁ Pushed ${files.length} files to Drive.\n`, 'success');
    showToast(`"${IDE.projectName}" synced to Drive ☁`, 3000);
  } catch (e) {
    ideAppendOutput(`Drive error: ${e.message}\n`, 'error');
    showToast('Sync failed: ' + e.message, 4000);
  }
}

async function _collectProjectFiles(dirPath) {
  const files = [];
  const ALLOWED = /\.(cpp|h|hpp|c|cc|cxx|hxx|json|pros|mk|txt|md|py)$/i;
  const SKIP    = new Set(['firmware', '.pros', 'node_modules', '.git', 'bin', 'obj']);

  async function walk(cur, prefix) {
    const entries = await window.electronAPI.ideListDir(cur);
    for (const e of entries) {
      if (e.isDir) {
        if (!SKIP.has(e.name)) await walk(e.path, prefix + e.name + '/');
      } else if (ALLOWED.test(e.name) || e.name === 'Makefile') {
        const content = await window.electronAPI.ideReadFile(e.path);
        if (content !== null) files.push({ name: prefix + e.name, content });
      }
    }
  }
  await walk(dirPath, '');
  return files;
}

// ─── DRIVE: LIST & PULL ───────────────────────────────────────────────────────

async function ideShowDrive() {
  if (!DRIVE.token) { showToast('Connect Google Drive in ⚙ Settings first.', 3000); ideShowSettings(); return; }
  document.getElementById('ideDriveModal').style.display = 'flex';
  ideRefreshDriveList();
}

function ideHideDrive() {
  document.getElementById('ideDriveModal').style.display = 'none';
}

async function ideRefreshDriveList() {
  const list = document.getElementById('ideDriveProjectList');
  if (!list) return;
  list.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--t3);">Loading…</div>';

  try {
    const rootId  = await _driveEnsureRoot();
    const res     = await _driveApi('GET', '/files', undefined, {
      q: `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id,name,modifiedTime)',
      orderBy: 'modifiedTime desc',
    });
    const projects = res.files || [];

    if (!projects.length) {
      list.innerHTML = '<div style="padding:20px 16px;font-size:12px;color:var(--t3);text-align:center;">No projects yet.<br>Push a project to get started.</div>';
      return;
    }

    list.innerHTML = '';
    for (const proj of projects) {
      const dt  = new Date(proj.modifiedTime).toLocaleDateString();
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;padding:11px 18px;border-bottom:1px solid var(--b1);gap:12px;';
      row.innerHTML = `
        <div style="flex:1;">
          <div style="font-size:13px;color:var(--t1);font-weight:600;">📁 ${proj.name}</div>
          <div style="font-size:11px;color:var(--t3);">Last synced: ${dt}</div>
        </div>
        <button class="btn-o" style="font-size:11px;" onclick="idePullProject('${proj.id}','${proj.name}')">⬇ Pull</button>`;
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div style="padding:16px;font-size:12px;color:#f87171;">Error: ${e.message}</div>`;
  }
}

async function idePullProject(driveProjectId, projectName) {
  ideHideDrive();
  if (!window.electronAPI) return;

  const projectsDir = await window.electronAPI.ideGetProjectsDir();
  const sep         = '\\';
  const localPath   = projectsDir + sep + projectName;

  ideClearOutput();
  ideAppendOutput(`Pulling "${projectName}" from Drive…\n`, 'cmd');

  try {
    const res   = await _driveApi('GET', '/files', undefined, {
      q: `'${driveProjectId}' in parents and trashed=false`,
      fields: 'files(id,name)',
    });
    const files = res.files || [];

    for (const file of files) {
      const parts   = file.name.split('/');
      const fname   = parts.pop();
      const subDir  = parts.join(sep);
      const dirPath = subDir ? localPath + sep + subDir : localPath;

      await window.electronAPI.ideMkdir(dirPath);

      const dlRes  = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: { Authorization: 'Bearer ' + DRIVE.token },
      });
      const content = await dlRes.text();
      await window.electronAPI.ideWriteFile(dirPath + sep + fname, content);
      ideAppendOutput(`  ✓ ${file.name}\n`, 'success');
    }

    ideAppendOutput(`\n☁ Pulled ${files.length} files.\n`, 'success');
    await ideLoadProject(localPath, projectName);
    showToast(`"${projectName}" pulled from Drive ☁`, 3000);
  } catch (e) {
    ideAppendOutput(`Drive error: ${e.message}\n`, 'error');
    showToast('Pull failed: ' + e.message, 4000);
  }
}
