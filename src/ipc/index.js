const automation = require('./automation');
const profile = require('./profile');
const group = require('./group');
const queue = require('./queue');
const syncQueue = require('./sync-queue');
const updater = require('./updater');
const trello = require('./trello');

/**
 * Đăng ký tất cả IPC handlers.
 * @param {{ pushStatus: Function, db: Object, getSessionDir: Function }} ctx
 */
function registerAllHandlers(ctx) {
  automation.register(ctx);
  profile.register(ctx);
  group.register(ctx);
  queue.register(ctx);
  syncQueue.register(ctx);
  updater.register();
  trello.register(ctx);
}

module.exports = {
  registerAllHandlers,
  getActiveAutomation: automation.getActiveAutomation,
  clearActiveAutomation: automation.clearActiveAutomation,
  getActiveQueues: queue.getActiveQueues,
  getActiveSyncQueues: syncQueue.getActiveSyncQueues,
};
