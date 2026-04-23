// ─── NEXUS APPLICATION MENU ───────────────────────────────────────────────────
// Native Electron menu for Nexus. Provides keyboard shortcuts and quick access
// to all three main sections of the app.

const { Menu, BrowserWindow, dialog, shell } = require('electron');

function send(js) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.executeJavaScript(js).catch(() => {});
}

function buildMenu(app) {
  const isMac = process.platform === 'darwin';

  const template = [
    // ── File ────────────────────────────────────────────────────────────────
    {
      label: 'File',
      submenu: [
        {
          label: 'Load Event…',
          accelerator: 'CmdOrCtrl+L',
          click: () => send('document.getElementById("evIn")?.focus()'),
        },
        {
          label: 'Import 3D Model…',
          accelerator: 'CmdOrCtrl+I',
          click: () => send('stlImport()'),
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('openSettings()'),
        },
        { type: 'separator' },
        isMac
          ? { role: 'close' }
          : { label: 'Quit Nexus', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },

    // ── View ────────────────────────────────────────────────────────────────
    {
      label: 'View',
      submenu: [
        {
          label: 'Scouting',
          accelerator: 'CmdOrCtrl+1',
          click: () => send('closeNotebook?.();closeSTLViewer?.();'),
        },
        {
          label: 'Engineering Notebook',
          accelerator: 'CmdOrCtrl+2',
          click: () => send('openNotebook?.()'),
        },
        {
          label: 'CAD Viewer',
          accelerator: 'CmdOrCtrl+3',
          click: () => send('openSTLViewer?.()'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // ── Data ────────────────────────────────────────────────────────────────
    {
      label: 'Data',
      submenu: [
        {
          label: 'Export Scouting Data',
          accelerator: 'CmdOrCtrl+E',
          click: () => send('exportData?.()'),
        },
        {
          label: 'Import Scouting Data',
          click: () => send('importData?.()'),
        },
        { type: 'separator' },
        {
          label: 'Refresh Matches',
          accelerator: 'CmdOrCtrl+R',
          click: () => send('refreshMatches?.()'),
        },
      ],
    },

    // ── Help ────────────────────────────────────────────────────────────────
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Nexus',
          click: () => {
            const win = BrowserWindow.getAllWindows()[0];
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About Nexus',
              message: 'Nexus — Vex Robotics Tool for All',
              detail: [
                'Version 1.0.1',
                '',
                'Built for VEX Robotics teams competing in VRC.',
                'Match scouting, engineering notebooks, and CAD visualization in one tool.',
              ].join('\n'),
              buttons: ['OK'],
            });
          },
        },
        {
          label: 'Check for Updates',
          click: () => {
            if (app.isPackaged) {
              const { autoUpdater } = require('electron-updater');
              autoUpdater.checkForUpdates();
            } else {
              const win = BrowserWindow.getAllWindows()[0];
              dialog.showMessageBox(win, {
                type: 'info',
                title: 'Updates',
                message: 'Updates are only checked in packaged builds.',
                buttons: ['OK'],
              });
            }
          },
        },
        { type: 'separator' },
        {
          label: 'RobotEvents',
          click: () => shell.openExternal('https://www.robotevents.com'),
        },
        {
          label: 'VEX Forum',
          click: () => shell.openExternal('https://www.vexforum.com'),
        },
      ],
    },
  ];

  // macOS: prepend the standard App menu
  if (isMac) {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => send('openSettings?.()') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
