const { t } = require('../utils/i18n');
const { ipcMain } = require('electron');
const SyncQueueController = require('../sync-queue/SyncQueueController');

const activeSyncQueues = new Map();

function normalizeSyncQueuePayload(payload = {}) {
  return {
    name: (payload.name || '').trim(),
    profileId: (payload.profileId || '').trim(),
    pageIdentity: payload.pageIdentity || 'personal',
    groupIds: Array.isArray(payload.groupIds) ? [...new Set(payload.groupIds.filter(Boolean))] : [],
    delayMinutes: Number(payload.delayMinutes) || 1,
  };
}

function validateSyncQueuePayload(queue) {
  if (!queue.name) throw new Error(t('backend.errors.queue_name_empty_2'));
  if (!queue.profileId) throw new Error(t('backend.errors.no_profile'));
  if (!Array.isArray(queue.groupIds) || queue.groupIds.length === 0) {
    throw new Error(t('backend.errors.min_groups'));
  }
}

async function assertPageNotRunning(db, queueId, pageIdentity) {
  if (!pageIdentity || pageIdentity === 'personal') return;

  for (const [runningId] of activeSyncQueues) {
    if (runningId === queueId) continue;
    const runningQueue = await db.getSyncQueueById(runningId);
    if (runningQueue && runningQueue.pageIdentity === pageIdentity) {
      throw new Error(t('backend.errors.page_in_use', {name: runningQueue.name}));
    }
  }

  // Cross-check with post-queue
  const { getActiveQueues } = require('./queue');
  const activeQs = getActiveQueues();
  for (const [runningId] of activeQs) {
    const runningPostQueue = await db.getQueueById(runningId);
    if (runningPostQueue && runningPostQueue.pageIdentity === pageIdentity) {
      throw new Error(t('backend.errors.page_in_use_sync', {name: runningPostQueue.name}));
    }
  }
}

/**
 * @param {{ pushStatus: Function, db: Object }} ctx
 */
function register(ctx) {
  const { pushStatus, db } = ctx;

  const pushSyncQueueStatus = () => {
    // Gui signal update cho tat ca cac client lang nghe
    try {
      const mainWindow = require('./helpers').getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync-queue:running_update', [...activeSyncQueues.keys()]);
      }
    } catch(e) {}
  };

  ipcMain.handle('sync-queue:list', async () => {
    return await db.getSyncQueues();
  });

  ipcMain.handle('sync-queue:add', async (_, payload) => {
    const queue = normalizeSyncQueuePayload(payload);
    validateSyncQueuePayload(queue);
    return await db.addSyncQueue(queue);
  });

  ipcMain.handle('sync-queue:update', async (_, { id, data }) => {
    const queue = normalizeSyncQueuePayload(data);
    validateSyncQueuePayload(queue);
    return await db.updateSyncQueue(id, queue);
  });

  ipcMain.handle('sync-queue:delete', async (_, id) => {
    if (activeSyncQueues.has(id)) {
      const entry = activeSyncQueues.get(id);
      await entry.controller.stop();
      activeSyncQueues.delete(id);
      pushSyncQueueStatus();
    }
    return await db.deleteSyncQueue(id);
  });

  ipcMain.handle('sync-queue:start', async (_, queueId) => {
    if (activeSyncQueues.has(queueId)) {
      throw new Error(t('backend.errors.process_running'));
    }

    const queue = await db.getSyncQueueById(queueId);
    if (!queue) throw new Error(t('backend.errors.queue_not_exist'));
    validateSyncQueuePayload(queue);
    await assertPageNotRunning(db, queueId, queue.pageIdentity);

    const profile = await db.getProfileById(queue.profileId);
    if (!profile || !profile.cookieString) {
      throw new Error(t('backend.errors.profile_no_cookies'));
    }

    const allGroups = await db.getGroups();
    const groups = queue.groupIds
      .map((groupId) => allGroups.find((g) => g.id === groupId))
      .filter(Boolean);

    if (groups.length === 0) throw new Error(t('backend.errors.no_valid_groups'));

    pushStatus(`Starting Group Sync campaign "${queue.name}"...`, 'running');

    const controller = new SyncQueueController({
      queueId,
      queue,
      profile,
      groups,
      db,
      onStatus: pushStatus,
      onQueueUpdate: (id, updatedQueue) => {
        const mainWindow = require('./helpers').getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('sync-queue:data_update', { id, queue: updatedQueue });
      },
    });

    const entry = { controller, browser: null };
    activeSyncQueues.set(queueId, entry);
    pushSyncQueueStatus();

    controller.start().then((result) => {
      entry.browser = result.browser;
      if (entry.browser) {
        entry.browser.once('disconnected', () => {
          activeSyncQueues.delete(queueId);
          pushStatus(`[${queue.name}] Browser closed.`, 'info');
          pushSyncQueueStatus();
        });
      }
    }).catch((error) => {
      activeSyncQueues.delete(queueId);
      pushStatus(`[${queue.name}] Launch error: ${error.message}`, 'error');
      pushSyncQueueStatus();
    });

    return { ok: true };
  });

  ipcMain.handle('sync-queue:stop', async (_, queueId) => {
    if (!activeSyncQueues.has(queueId)) {
      return { ok: true, stopped: false };
    }

    const entry = activeSyncQueues.get(queueId);
    await entry.controller.stop();
    activeSyncQueues.delete(queueId);

    pushStatus('Sync Process stopped.', 'info');
    pushSyncQueueStatus();

    return { ok: true, stopped: true };
  });

  ipcMain.handle('sync-queue:reset', async (_, queueId) => {
    if (activeSyncQueues.has(queueId)) {
      throw new Error(t('backend.errors.process_running'));
    }

    const queue = await db.getSyncQueueById(queueId);
    if (!queue) throw new Error(t('backend.errors.queue_not_exist'));

    await db.updateSyncQueue(queueId, {
      state: { currentGroupIndex: 0, status: 'idle' },
      logs: [],
    });

    return { ok: true };
  });

  ipcMain.handle('sync-queue:running_ids', async () => {
    return [...activeSyncQueues.keys()];
  });
}

// Expose để main.js cleanup
function getActiveSyncQueues() {
  return activeSyncQueues;
}

module.exports = {
  register,
  getActiveSyncQueues,
};
