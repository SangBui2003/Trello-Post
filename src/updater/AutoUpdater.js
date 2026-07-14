const log = require('electron-log');

let mainWindow = null;

function init(window) {
  mainWindow = window;
  log.info('[AutoUpdater] Auto-updater module initialized in disabled mode.');
}

async function checkForUpdates() {
  log.info('[AutoUpdater] Check for updates requested (Auto-update is disabled).');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', { status: 'up-to-date' });
  }
  return null;
}

async function downloadUpdate() {
  log.info('[AutoUpdater] Download update requested (Auto-update is disabled).');
  return null;
}

function quitAndInstall() {
  log.info('[AutoUpdater] Install update requested (Auto-update is disabled).');
}

module.exports = {
  init,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
};
