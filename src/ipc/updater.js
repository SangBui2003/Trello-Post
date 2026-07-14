const { ipcMain, app } = require('electron');
const autoUpdater = require('../updater/AutoUpdater');

function register() {
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates());
  ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
  ipcMain.handle('update:get-version', () => app.getVersion());
}

module.exports = { register };
