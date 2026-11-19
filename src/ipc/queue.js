const { t } = require('../utils/i18n');
const fs = require('fs');
const { ipcMain, Notification, shell } = require('electron');
const { PostQueueController } = require('../post-queue');
const { getMainWindow } = require('./helpers');

// Multi-queue: map queueId -> { controller, browser, isClosing }
const activeQueues = new Map();
const startingQueues = new Set();

function normalizeQueuePayload(payload = {}) {
  const posts = Array.isArray(payload.posts)
    ? payload.posts.map((post) => ({
        selected: post.selected !== undefined ? Boolean(post.selected) : true,
        content: (post.content || '').trim(),
        commentText: (post.commentText || '').trim(),
        imagePath: post.imagePath || '',
        imageBase64: post.imageBase64 || '',
        imageUrl: post.imageUrl || '',
        thumbnailUrl: post.thumbnailUrl || '',
        trelloCardId: post.trelloCardId || '',
        trelloCardName: post.trelloCardName || '',
        enableSchedule: Boolean(post.enableSchedule),
        scheduleType: post.scheduleType === 'delay' ? 'delay' : 'exact',
        scheduledTime: post.scheduledTime || '',
        delayHours: Math.max(0, parseInt(post.delayHours, 10) || 0),
        delayMinutes: Math.max(0, parseInt(post.delayMinutes, 10) || 0),
      })).filter((post) => post.content)
    : [];

  return {
    name: (payload.name || '').trim(),
    profileId: (payload.profileId || '').trim(),
    pageIdentity: payload.pageIdentity || 'personal',
    trelloBoardId: payload.trelloBoardId || '',
    trelloListId: payload.trelloListId || '',
    trelloListName: payload.trelloListName || '',
    posts,
    delayMinutes: Number(payload.delayMinutes) || 5,
    enableTimer: payload.enableTimer !== undefined ? Boolean(payload.enableTimer) : true,
    approvalMode: Boolean(payload.approvalMode),
  };
}

function validateQueuePayload(queue) {
  if (!queue.name) {
    throw new Error(t('backend.errors.queue_name_empty'));
  }

  if (!queue.profileId) {
    throw new Error(t('backend.errors.no_profile'));
  }
}

/**
 * Kiểm tra page hoặc profile có đang được dùng bởi hàng đợi đang chạy không.
 * Cho phép tạo nhiều hàng đợi cùng page/profile, nhưng chỉ 1 được chạy tại 1 thời điểm.
 */
async function assertPageNotRunning(db, queueId, pageIdentity, profileId) {
  const runningIds = new Set([...activeQueues.keys(), ...startingQueues]);

  for (const runningId of runningIds) {
    if (runningId === queueId) continue;

    const runningQueue = await db.getQueueById(runningId);
    if (!runningQueue) continue;

    if (pageIdentity && pageIdentity !== 'personal' && runningQueue.pageIdentity === pageIdentity) {
      throw new Error(t('backend.errors.page_in_use', {name: runningQueue.name}));
    }

    if (profileId && runningQueue.profileId === profileId) {
      throw new Error(`Profile của hàng đợi này đang được sử dụng bởi hàng đợi "${runningQueue.name}". Vui lòng dùng Profile riêng cho từng hàng đợi chạy song song hoặc đợi hàng đợi kia hoàn tất.`);
    }
  }

  // Cross-check with sync-queue
  if (pageIdentity && pageIdentity !== 'personal') {
    const { getActiveSyncQueues } = require('./sync-queue');
    const activeSyncQs = getActiveSyncQueues();
    for (const [runningId] of activeSyncQs) {
      if (runningId === queueId) continue;
      const runningSyncQueue = await db.getSyncQueueById(runningId);
      if (runningSyncQueue && runningSyncQueue.pageIdentity === pageIdentity) {
        throw new Error(t('backend.errors.page_in_use_sync', {name: runningSyncQueue.name}));
      }
    }
  }
}

function pushQueueStatus() {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.webContents.send('queue:running_update', [...activeQueues.keys()]);
}

/**
 * @param {{ pushStatus: Function, db: Object, getSessionDir: Function }} ctx
 */
function register(ctx) {
  const { pushStatus, db, getSessionDir } = ctx;

  ipcMain.handle('queue:list', async () => {
    return await db.getQueues();
  });

  ipcMain.handle('queue:add', async (_, payload) => {
    const queue = normalizeQueuePayload(payload);
    validateQueuePayload(queue);
    return await db.addQueue(queue);
  });

  ipcMain.handle('queue:update', async (_, { id, data }) => {
    const queue = normalizeQueuePayload(data);
    validateQueuePayload(queue);
    return await db.updateQueue(id, queue);
  });

  ipcMain.handle('queue:delete', async (_, id) => {
    // Dừng queue nếu đang chạy
    if (activeQueues.has(id)) {
      const entry = activeQueues.get(id);
      await entry.controller.stop();
      activeQueues.delete(id);
      pushQueueStatus();
    }

    return await db.deleteQueue(id);
  });

  ipcMain.handle('queue:start', async (_, queueId) => {
    if (activeQueues.has(queueId) || startingQueues.has(queueId)) {
      throw new Error(t('backend.errors.process_running'));
    }

    startingQueues.add(queueId);

    let queue;
    let profile;
    try {
      queue = await db.getQueueById(queueId);
      if (!queue) {
        throw new Error(t('backend.errors.queue_not_exist_2'));
      }

      validateQueuePayload(queue);

      // Chỉ cho phép 1 hàng đợi cùng page hoặc cùng profile chạy tại 1 thời điểm
      await assertPageNotRunning(db, queueId, queue.pageIdentity, queue.profileId);

      profile = await db.getProfileById(queue.profileId);
      if (!profile) {
        const allProfiles = await db.getProfiles();
        console.error(`[QueueStart] Profile ${queue.profileId} not found. Available IDs:`, allProfiles.map(p => p.id));
        throw new Error(t('backend.errors.profile_not_exist'));
      }

      if (!profile.cookieString) {
        throw new Error(t('backend.errors.invalid_cookies'));
      }

      if (!queue.posts || queue.posts.length === 0) {
        throw new Error('Hàng đợi chưa có thẻ/bài viết nào để đăng! Vui lòng thêm bài viết trước khi bắt đầu.');
      }

      const selectedPosts = queue.posts.filter((post) => post.selected !== false);
      if (selectedPosts.length === 0) {
        throw new Error('Hàng đợi không có bài viết nào được chọn để đăng! Vui lòng tích chọn bài viết trước khi bắt đầu.');
      }

      // Validate ảnh trong mỗi bài viết ĐƯỢC CHỌN (cho phép bài viết Trello tải ảnh JIT khi chạy)
      for (const post of selectedPosts) {
        const hasValidPath = post.imagePath && fs.existsSync(post.imagePath);
        const hasBase64 = !!post.imageBase64;
        const hasTrello = !!(post.trelloCardId || post.imageUrl);
        
        if (!hasValidPath && !hasBase64 && !hasTrello) {
          if (post.imagePath) {
            throw new Error(t('backend.errors.image_not_found', {path: post.imagePath}));
          }
        }
      }
    } catch (err) {
      startingQueues.delete(queueId);
      throw err;
    }

    pushStatus(`Starting queue "${queue.name}"...`, 'running');

    const controller = new PostQueueController({
      queueId,
      queue,
      profile,
      sessionDir: getSessionDir('fb-queue-session'),
      db,
      onStatus: pushStatus,
      onComplete: () => {
        if (activeQueues.get(queueId)?.controller === controller) {
          activeQueues.delete(queueId);
          pushQueueStatus();
        }
      },
      onQueueUpdate: (id, updatedQueue) => {
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('queue:data_update', { id, queue: updatedQueue });
      },
      onNotify: (message) => {
        const notification = new Notification({
          title: 'Tool Upload Facebook',
          body: message,
          silent: false,
        });

        notification.on('click', () => {
          const mainWindow = getMainWindow();
          if (!mainWindow || mainWindow.isDestroyed()) return;

          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        });

        notification.show();
        shell.beep();
      },
    });

    const entry = { controller, browser: null, isClosing: false };
    activeQueues.set(queueId, entry);
    startingQueues.delete(queueId);
    pushQueueStatus();

    // Chạy bất đồng bộ — không block IPC
    controller.start().then((result) => {
      entry.browser = result.browser;

      // Lắng nghe browser đóng bất thường
      if (entry.browser) {
        entry.browser.once('disconnected', () => {
          if (entry.isClosing) return;

          activeQueues.delete(queueId);
          pushStatus(`[${queue.name}] Browser was closed.`, 'info');
          pushQueueStatus();
        });
      }
    }).catch((error) => {
      activeQueues.delete(queueId);
      pushStatus(`[${queue.name}] Launch error: ${error.message}`, 'error');
      pushQueueStatus();
    });

    return { ok: true };
  });

  ipcMain.handle('queue:stop', async (_, queueId) => {
    if (!activeQueues.has(queueId)) {
      return { ok: true, stopped: false };
    }

    const entry = activeQueues.get(queueId);
    entry.isClosing = true;
    await entry.controller.stop();
    activeQueues.delete(queueId);

    pushStatus(`Đã dừng tự động đăng bài cho hàng đợi: ${entry.controller?.queue?.name || queueId}. Trình duyệt vẫn được giữ mở.`, 'info');
    pushQueueStatus();

    return { ok: true, stopped: true };
  });

  ipcMain.handle('queue:stop_all', async () => {
    const ids = [...activeQueues.keys()];
    for (const id of ids) {
      const entry = activeQueues.get(id);
      entry.isClosing = true;
      await entry.controller.stop();
      activeQueues.delete(id);
    }

    pushStatus('Đã dừng tất cả hàng đợi. Trình duyệt vẫn được giữ mở.', 'info');
    pushQueueStatus();

    return { ok: true, stopped: ids.length };
  });

  ipcMain.handle('queue:approve', async (_, queueId) => {
    if (activeQueues.has(queueId)) {
      const entry = activeQueues.get(queueId);
      await entry.controller.approve();
      return { ok: true };
    }
    return { ok: false, error: 'Queue is not running or not pending approval.' };
  });

  ipcMain.handle('queue:reset', async (_, queueId) => {
    if (activeQueues.has(queueId)) {
      throw new Error(t('backend.errors.cannot_reset_running'));
    }

    const queue = await db.getQueueById(queueId);
    if (!queue) throw new Error(t('backend.errors.queue_not_exist_2'));

    // Reset state và logs
    await db.updateQueue(queueId, {
      state: { currentGroupIndex: 0, currentPostIndex: 0, status: 'idle' },
      logs: [],
    });

    return { ok: true };
  });

  ipcMain.handle('queue:focus', async (_, queueId) => {
    if (activeQueues.has(queueId)) {
      const entry = activeQueues.get(queueId);
      await entry.controller.focus();
      return { ok: true };
    }
    return { ok: false, error: 'Queue is not running.' };
  });

  ipcMain.handle('queue:running_ids', async () => {
    return [...activeQueues.keys()];
  });
}

// Expose để main.js cleanup khi quit
function getActiveQueues() {
  return activeQueues;
}

module.exports = {
  register,
  getActiveQueues,
};
