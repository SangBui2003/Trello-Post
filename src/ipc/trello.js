const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const TrelloManager = require('../utils/trello');

const CONFIG_PATH = path.join(app.getPath('userData'), 'trello-config.json');
const TINFOS_CONFIG_PATH = path.join(app.getPath('userData'), 'tinfos-config.json');
const TRELLO_SELECTIONS_PATH = path.join(app.getPath('userData'), 'trello-selections.json');

function getTrelloSelections() {
  if (fs.existsSync(TRELLO_SELECTIONS_PATH)) {
    try { return JSON.parse(fs.readFileSync(TRELLO_SELECTIONS_PATH, 'utf8')); } catch { return {}; }
  }
  return {};
}

function saveTrelloSelections(selections) {
  fs.writeFileSync(TRELLO_SELECTIONS_PATH, JSON.stringify(selections, null, 2));
}

function getTinfosConfig() {
  if (fs.existsSync(TINFOS_CONFIG_PATH)) {
    try { return JSON.parse(fs.readFileSync(TINFOS_CONFIG_PATH, 'utf8')); } catch { return {}; }
  }
  return {};
}

function saveTinfosConfig(config) {
  fs.writeFileSync(TINFOS_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
      return { apiKey: '', apiToken: '' };
    }
  }
  return { apiKey: '', apiToken: '' };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getManager() {
  const config = getConfig();
  if (!config.apiKey || !config.apiToken) {
    throw new Error('Trello API Key and Token are not configured.');
  }
  return new TrelloManager(config.apiKey, config.apiToken);
}

function register(ctx) {
  ipcMain.handle('trello:get_config', () => {
    return getConfig();
  });

  ipcMain.handle('trello:save_config', (event, config) => {
    saveConfig(config);
    return true;
  });

  ipcMain.handle('trello:get_boards', async () => {
    return getManager().getBoards();
  });

  ipcMain.handle('trello:get_lists', async (event, boardId) => {
    return getManager().getLists(boardId);
  });

  ipcMain.handle('trello:get_cards', async (event, listId) => {
    return getManager().getCards(listId);
  });

  ipcMain.handle('trello:download_image', async (event, { cardId, fileName }) => {
    const manager = getManager();
    const attachments = await manager.getCardAttachments(cardId);
    if (!attachments || attachments.length === 0) return null;
    
    // Get the first image attachment
    const imgAttachment = attachments.find(a => a.mimeType && a.mimeType.startsWith('image/'));
    if (!imgAttachment) return null;

    const tempDir = path.join(app.getPath('userData'), 'temp_images');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    let safeFileName = fileName ? fileName.replace(/[^a-z0-9.]/gi, '_').toLowerCase() : 'trello_img.jpg';
    // Truncate to avoid MAX_PATH and filename length limits strictly
    if (safeFileName.length > 40) {
      const ext = path.extname(safeFileName) || '.jpg';
      safeFileName = safeFileName.substring(0, 30) + ext;
    }
    const filePath = path.join(tempDir, `${cardId}_${safeFileName}`);
    
    const finalPath = await manager.downloadImage(imgAttachment.url, filePath);
    
    // Read the file and convert to base64 for preview/storage
    try {
      const data = fs.readFileSync(finalPath);
      const base64 = `data:${imgAttachment.mimeType || 'image/jpeg'};base64,${data.toString('base64')}`;
      return { filePath: finalPath, base64 };
    } catch (e) {
      console.error('Error reading image for base64:', e);
      return { filePath: finalPath, base64: null };
    }
  });

  const { wrapLink, loginTinfos } = require('../browser/TinfosWrapper');
  ipcMain.handle('trello:wrap_tinfos', async (event, originalLink) => {
    const cfg = getTinfosConfig();
    return wrapLink(originalLink, cfg.domain || '');
  });

  ipcMain.handle('trello:login_tinfos', async () => {
    return loginTinfos();
  });

  ipcMain.handle('trello:get_tinfos_config', () => getTinfosConfig());
  ipcMain.handle('trello:save_tinfos_config', (event, config) => { saveTinfosConfig(config); return true; });

  ipcMain.handle('trello:get_selections', (event, queueId) => {
    const selections = getTrelloSelections();
    return selections[queueId || 'new'] || { boardId: '', listId: '' };
  });

  ipcMain.handle('trello:save_selections', (event, { queueId, boardId, listId }) => {
    const selections = getTrelloSelections();
    selections[queueId || 'new'] = { boardId, listId };
    saveTrelloSelections(selections);
    return true;
  });
}

module.exports = { register };
