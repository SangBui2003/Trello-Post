const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  setLanguage: (lang) => ipcRenderer.send('set-language', lang),
  getConfig: () => ipcRenderer.invoke('config:get'),
  selectImage: () => ipcRenderer.invoke('image:select'),
  prepareDraft: (payload) => ipcRenderer.invoke('automation:prepare', payload),
  completeDraft: () => ipcRenderer.invoke('automation:complete'),
  onStatus: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('automation:status', listener);

    return () => {
      ipcRenderer.removeListener('automation:status', listener);
    };
  },
  
  getProfiles: () => ipcRenderer.invoke('profile:list'),
  openProfile: (id) => ipcRenderer.invoke('profile:open', id),
  deleteProfile: (id) => ipcRenderer.invoke('profile:delete', id),
  startProfileLogin: (profileId) => ipcRenderer.invoke('profile:start_login', profileId),
  saveProfile: (payload) => ipcRenderer.invoke('profile:save', payload),
  
  getGroups: () => ipcRenderer.invoke('group:list'),
  addGroup: (payload) => ipcRenderer.invoke('group:add', payload),
  updateGroup: (id, data) => ipcRenderer.invoke('group:update', { id, data }),
  deleteGroup: (id) => ipcRenderer.invoke('group:delete', id),
  deleteGroups: (ids) => ipcRenderer.invoke('group:delete_multiple', ids),
  importGroups: (groups) => ipcRenderer.invoke('group:import', groups),

  scanProfilePages: (profileId) => ipcRenderer.invoke('profile:scan_pages', profileId),
  getProfilePages: (profileId) => ipcRenderer.invoke('profile:get_pages', profileId),
  updatePageName: (profileId, pageId, newName) => ipcRenderer.invoke('profile:update_page_name', { profileId, pageId, newName }),
  updateProfileToken: (profileId, name, cookieString, metadata) => ipcRenderer.invoke('profile:update_token', { profileId, name, cookieString, metadata }),
  exportProfilesToExcel: (profileIds) => ipcRenderer.invoke('profile:export_excel', profileIds),
  syncProfilesToSheets: (profileIds, webAppUrl) => ipcRenderer.invoke('profile:sync_sheets', { profileIds, webAppUrl }),
  getRunningProfileIds: () => ipcRenderer.invoke('profile:running_ids'),
  onProfileRunningUpdate: (callback) => {
    const listener = (_, ids) => callback(ids);
    ipcRenderer.on('profile:running_update', listener);
    return () => {
      ipcRenderer.removeListener('profile:running_update', listener);
    };
  },

  getQueues: () => ipcRenderer.invoke('queue:list'),
  addQueue: (payload) => ipcRenderer.invoke('queue:add', payload),
  updateQueue: (id, data) => ipcRenderer.invoke('queue:update', { id, data }),
  deleteQueue: (id) => ipcRenderer.invoke('queue:delete', id),
  startQueue: (queueId) => ipcRenderer.invoke('queue:start', queueId),
  stopQueue: (queueId) => ipcRenderer.invoke('queue:stop', queueId),
  stopAllQueues: () => ipcRenderer.invoke('queue:stop_all'),
  approveQueue: (queueId) => ipcRenderer.invoke('queue:approve', queueId),
  resetQueue: (queueId) => ipcRenderer.invoke('queue:reset', queueId),
  focusQueue: (queueId) => ipcRenderer.invoke('queue:focus', queueId),
  getRunningQueueIds: () => ipcRenderer.invoke('queue:running_ids'),
  onQueueRunningUpdate: (callback) => {
    const listener = (_, runningIds) => callback(runningIds);
    ipcRenderer.on('queue:running_update', listener);

    return () => {
      ipcRenderer.removeListener('queue:running_update', listener);
    };
  },
  onQueueDataUpdate: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('queue:data_update', listener);

    return () => {
      ipcRenderer.removeListener('queue:data_update', listener);
    };
  },

  getSyncQueues: () => ipcRenderer.invoke('sync-queue:list'),
  addSyncQueue: (payload) => ipcRenderer.invoke('sync-queue:add', payload),
  updateSyncQueue: (id, data) => ipcRenderer.invoke('sync-queue:update', { id, data }),
  deleteSyncQueue: (id) => ipcRenderer.invoke('sync-queue:delete', id),
  startSyncQueue: (queueId) => ipcRenderer.invoke('sync-queue:start', queueId),
  stopSyncQueue: (queueId) => ipcRenderer.invoke('sync-queue:stop', queueId),
  resetSyncQueue: (queueId) => ipcRenderer.invoke('sync-queue:reset', queueId),
  getRunningSyncQueueIds: () => ipcRenderer.invoke('sync-queue:running_ids'),
  onSyncQueueRunningUpdate: (callback) => {
    const listener = (_, runningIds) => callback(runningIds);
    ipcRenderer.on('sync-queue:running_update', listener);

    return () => {
      ipcRenderer.removeListener('sync-queue:running_update', listener);
    };
  },
  onSyncQueueDataUpdate: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('sync-queue:data_update', listener);

    return () => {
      ipcRenderer.removeListener('sync-queue:data_update', listener);
    };
  },

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getAppVersion: () => ipcRenderer.invoke('update:get-version'),
  onUpdateStatus: (callback) => {
    const listener = (_, payload) => callback(payload);
    ipcRenderer.on('update:status', listener);

    return () => {
      ipcRenderer.removeListener('update:status', listener);
    };
  },
  
  // Trello
  getTrelloConfig: () => ipcRenderer.invoke('trello:get_config'),
  saveTrelloConfig: (config) => ipcRenderer.invoke('trello:save_config', config),
  getTrelloBoards: () => ipcRenderer.invoke('trello:get_boards'),
  getTrelloLists: (boardId) => ipcRenderer.invoke('trello:get_lists', boardId),
  getTrelloCards: (listId, excludedCardIds = []) => ipcRenderer.invoke('trello:get_cards', listId, excludedCardIds),
  downloadTrelloImage: (payload) => ipcRenderer.invoke('trello:download_image', payload),
  getTrelloThumbnailBase64: (url) => ipcRenderer.invoke('trello:get_thumbnail_base64', url),
  wrapTinfosLink: (originalLink) => ipcRenderer.invoke('trello:wrap_tinfos', originalLink),
  loginTinfos: () => ipcRenderer.invoke('trello:login_tinfos'),
  getTinfosConfig: () => ipcRenderer.invoke('trello:get_tinfos_config'),
  saveTinfosConfig: (config) => ipcRenderer.invoke('trello:save_tinfos_config', config),
  getCTAConfig: () => ipcRenderer.invoke('trello:get_cta_config'),
  saveCTAConfig: (config) => ipcRenderer.invoke('trello:save_cta_config', config),
  getTrelloSelections: (queueId) => ipcRenderer.invoke('trello:get_selections', queueId),
  saveTrelloSelections: (payload) => ipcRenderer.invoke('trello:save_selections', payload),
  syncTrelloCards: (payload) => ipcRenderer.invoke('trello:sync_cards', payload),
});
