const path = require('path');
const { setLanguage } = require('./src/utils/i18n');
const { app, BrowserWindow, nativeTheme } = require('electron');
const db = require('./src/db/Database');
const { setMainWindow, getMainWindow } = require('./src/ipc/helpers');
const {
  registerAllHandlers,
  getActiveAutomation,
  clearActiveAutomation,
  getActiveQueues,
} = require('./src/ipc');
const autoUpdater = require('./src/updater/AutoUpdater');

function pushStatus(message, level = 'info') {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send('automation:status', {
    message,
    level,
    timestamp: new Date().toISOString(),
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc',
    show: false,
    title: 'PostPilot',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));

  setMainWindow(mainWindow);
}

// Đăng ký tất cả IPC handlers
registerAllHandlers({
  pushStatus,
  db,
  getSessionDir: (name) => path.join(app.getPath('userData'), name),
});

const { ipcMain } = require('electron');
ipcMain.on('set-language', (event, lang) => {
  setLanguage(lang);
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    // Initialize auto-updater after window is ready
    autoUpdater.init(getMainWindow());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('before-quit', async () => {
  // Đóng automation đơn lẻ (PostGroup)
  const activeAutomation = getActiveAutomation();
  if (activeAutomation) {
    await activeAutomation.browser.close().catch(() => {});
    clearActiveAutomation();
  }

  // Đóng tất cả queue đang chạy
  const activeQueues = getActiveQueues();
  for (const [id, entry] of activeQueues) {
    entry.isClosing = true;
    await entry.controller.stop();
    activeQueues.delete(id);
  }

  // Close SQLite database connection
  db.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
