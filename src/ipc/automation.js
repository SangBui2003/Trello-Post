const { t } = require('../utils/i18n');
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');
const { preparePostGroupDraft } = require('../post-group');
const { facebook } = require('../config');

let activeAutomation = null;
let automationLaunching = false;

function registerActiveAutomation(session, pushStatus, disconnectedMessage) {
  activeAutomation = session;

  activeAutomation.browser.once('disconnected', () => {
    if (session.isClosing) return;

    activeAutomation = null;
    pushStatus(disconnectedMessage, 'info');
  });
}

async function closeActiveAutomation(pushStatus, message) {
  if (!activeAutomation) {
    return { ok: true, closed: false };
  }

  activeAutomation.isClosing = true;
  await activeAutomation.browser.close().catch(() => {});
  activeAutomation = null;
  pushStatus(message);

  return { ok: true, closed: true };
}

function assertAutomationAvailable() {
  if (activeAutomation || automationLaunching) {
    throw new Error(t('backend.errors.session_open'));
  }
}

/**
 * @param {{ pushStatus: Function, getSessionDir: Function }} ctx
 */
function register(ctx) {
  const { pushStatus, getSessionDir } = ctx;

  ipcMain.handle('config:get', async () => {
    return { groupUrl: facebook.groupUrl };
  });

  ipcMain.handle('image:select', async () => {
    const { dialog } = require('electron');
    const { getMainWindow } = require('./helpers');
    const mainWindow = getMainWindow();

    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select image to post',
      properties: ['openFile'],
      filters: [
        {
          name: 'Image Files',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
        },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    try {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      const base64 = `data:${mime};base64,${data.toString('base64')}`;
      return { filePath, base64 };
    } catch (e) {
      console.error('Error reading selected image for base64:', e);
      return { filePath, base64: null };
    }
  });

  ipcMain.handle('automation:prepare', async (_, payload) => {
    assertAutomationAvailable();

    const content = (payload?.content || '').trim();
    const imagePath = payload?.imagePath || '';
    const cookieString = (payload?.cookieString || '').trim();
    const pageIdentity = payload?.pageIdentity || null;
    const profileId = payload?.profileId || null;

    if (!cookieString) {
      throw new Error(t('backend.errors.missing_cookies'));
    }

    if (!content) {
      throw new Error(t('backend.errors.post_content_empty'));
    }

    if (imagePath && !fs.existsSync(imagePath)) {
      throw new Error(t('backend.errors.selected_image_not_found'));
    }
    
    let metadata = {};
    let profileName = 'Trello Sync';
    if (profileId) {
      const db = require('../db/Database');
      const profile = await db.getProfileById(profileId);
      if (profile) {
        profileName = profile.name;
        if (profile.metadata) metadata = profile.metadata;
      }
    }

    pushStatus('Launching browser and preparing post...', 'running');

    automationLaunching = true;
    try {
      const session = await preparePostGroupDraft({
        content,
        imagePath,
        cookieString,
        pageIdentity,
        metadata,
        profileName,
        groupUrl: facebook.groupUrl,
        sessionDir: getSessionDir('fb-session'),
        onStatus: pushStatus,
      });

      registerActiveAutomation(session, pushStatus, 'Facebook browser has been closed.');
    } finally {
      automationLaunching = false;
    }

    pushStatus('Post has been filled. Please review on Facebook and click Post manually.', 'success');
    return { ok: true };
  });

  ipcMain.handle('automation:complete', async () => {
    return await closeActiveAutomation(pushStatus, 'Current session browser closed.');
  });
}

// Expose để main.js có thể cleanup khi quit
function getActiveAutomation() {
  return activeAutomation;
}

function clearActiveAutomation() {
  activeAutomation = null;
}

module.exports = {
  register,
  getActiveAutomation,
  clearActiveAutomation,
};
