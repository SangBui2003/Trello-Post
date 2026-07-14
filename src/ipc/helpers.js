let mainWindow = null;

// Global clipboard lock to prevent overlap when running multiple queues
let clipboardPromiseChain = Promise.resolve();

async function acquireClipboardLock() {
  let release;
  const nextPromise = new Promise((resolve) => {
    release = resolve;
  });
  const currentPromise = clipboardPromiseChain;
  clipboardPromiseChain = currentPromise.then(() => nextPromise).catch(() => nextPromise);
  await currentPromise;
  return release;
}

function setMainWindow(win) {
  mainWindow = win;
}

function getMainWindow() {
  return mainWindow;
}

module.exports = {
  setMainWindow,
  getMainWindow,
  acquireClipboardLock,
};
