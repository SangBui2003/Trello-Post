const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');
const TrelloManager = require('../utils/trello');

const CONFIG_PATH = path.join(app.getPath('userData'), 'trello-config.json');
const TINFOS_CONFIG_PATH = path.join(app.getPath('userData'), 'tinfos-config.json');
const TRELLO_SELECTIONS_PATH = path.join(app.getPath('userData'), 'trello-selections.json');
const CTA_CONFIG_PATH = path.join(app.getPath('userData'), 'cta-config.json');

const DEFAULT_CTAS = ["𝑾𝑨𝑻𝑪𝑯 👉", "𝑭𝒖𝒍𝒍 𝒔𝒕𝒐𝒓𝒚 👉", "𝑹𝒆𝒂𝒅 𝒎𝒐𝒓𝒆 👉", "𝑼𝒑𝒅𝒂𝒕𝒆 𝑵𝒆𝒘 𝑻𝒐𝒅𝒂𝒚👉"];
const thumbnailCache = new Map();

async function downloadCardImageDirect(cardId, fileName, imageUrl) {
  const manager = getManager();
  const tempDir = path.join(app.getPath('userData'), 'temp_images');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  let safeFileName = fileName ? fileName.replace(/[^a-z0-9.]/gi, '_').toLowerCase() : 'trello_img.jpg';
  const rawExt = path.extname(safeFileName).toLowerCase();
  const validExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(rawExt) ? rawExt : '.jpg';
  const basePart = (rawExt === validExt ? safeFileName.slice(0, -rawExt.length) : safeFileName).replace(/\./g, '_').slice(0, 30) || 'trello_img';
  safeFileName = `${basePart}${validExt}`;
  const filePath = path.join(tempDir, `${cardId || 'img'}_${safeFileName}`);

  // Trả về ngay nếu file đã được tải trước đó và hợp lệ
  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 0) {
        return { filePath };
      }
    } catch {}
  }

  let targetUrl = imageUrl;
  if (!targetUrl && cardId) {
    const attachments = await manager.getCardAttachments(cardId);
    if (attachments && attachments.length > 0) {
      const imgAttachment = attachments.find(a => a.mimeType && a.mimeType.startsWith('image/')) || attachments[0];
      if (imgAttachment) {
        targetUrl = imgAttachment.url;
      }
    }
  }

  if (!targetUrl) {
    throw new Error('Không tìm thấy link ảnh đính kèm trên thẻ Trello');
  }

  const finalPath = await manager.downloadImage(targetUrl, filePath);
  return { filePath: finalPath };
}

function getCTAConfig() {
  if (fs.existsSync(CTA_CONFIG_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(CTA_CONFIG_PATH, 'utf8'));
      if (Array.isArray(data)) return data;
    } catch {
      return DEFAULT_CTAS;
    }
  }
  return DEFAULT_CTAS;
}

function saveCTAConfig(config) {
  fs.writeFileSync(CTA_CONFIG_PATH, JSON.stringify(config, null, 2));
}

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
  const rawDomain = config?.domain ? String(config.domain).trim() : '';
  const cleanDomain = rawDomain.replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].split('#')[0].trim();
  fs.writeFileSync(TINFOS_CONFIG_PATH, JSON.stringify({ ...config, domain: cleanDomain }, null, 2));
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

  ipcMain.handle('trello:get_cards', async (event, listId, excludedCardIds = []) => {
    return getManager().getCards(listId, 2, excludedCardIds);
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
    const rawExt = path.extname(safeFileName).toLowerCase();
    const validExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(rawExt) ? rawExt : '.jpg';
    const basePart = (rawExt === validExt ? safeFileName.slice(0, -rawExt.length) : safeFileName).replace(/\./g, '_').slice(0, 30) || 'trello_img';
    safeFileName = `${basePart}${validExt}`;
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

  ipcMain.handle('trello:get_thumbnail_base64', async (event, previewUrl) => {
    if (!previewUrl) return null;
    if (thumbnailCache.has(previewUrl)) {
      return thumbnailCache.get(previewUrl);
    }
    try {
      const manager = getManager();
      const response = await fetch(previewUrl, {
        method: 'GET',
        headers: {
          'Authorization': `OAuth oauth_consumer_key="${manager.apiKey}", oauth_token="${manager.apiToken}"`
        }
      });
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      if (thumbnailCache.size > 500) {
        const firstKey = thumbnailCache.keys().next().value;
        thumbnailCache.delete(firstKey);
      }
      thumbnailCache.set(previewUrl, base64);
      return base64;
    } catch (e) {
      console.error('Error fetching thumbnail:', e);
      return null;
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

  ipcMain.handle('trello:get_cta_config', () => getCTAConfig());
  ipcMain.handle('trello:save_cta_config', (event, config) => { saveCTAConfig(config); return true; });

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

  ipcMain.handle('trello:sync_cards', async (event, { listId, autoWrapLink = true, excludedCardIds = [] }) => {
    if (!listId) throw new Error('Chưa chọn danh sách Trello (List ID trống)');
    const manager = getManager();
    // Exclude existing posts before link wrapping and other per-card processing.
    const cards = await manager.getCards(listId, 2, excludedCardIds);
    if (!cards || cards.length === 0) return [];

    const cfg = getTinfosConfig();
    const ctaList = getCTAConfig();

    const results = [];
    for (const card of cards) {
      try {
        const desc = card.desc || '';
        const urlMatch = desc.match(/(https?:\/\/[^\s\n]+)/);

        let wrappedLink = '';
        let baseContent = card.name;

        if (urlMatch) {
          const originalLink = urlMatch[0];
          const cleanedDesc = desc.replace(originalLink, '').trim();
          baseContent = cleanedDesc ? `${card.name}\n\n${cleanedDesc}` : card.name;
          wrappedLink = originalLink;

          if (autoWrapLink) {
            try {
              wrappedLink = await wrapLink(originalLink, cfg.domain || '');
            } catch (err) {
              console.warn(`Lỗi wrap link thẻ "${card.name}":`, err.message);
              wrappedLink = originalLink;
            }
          }
        } else {
          baseContent = desc ? `${card.name}\n\n${desc}` : card.name;
        }

        const cta = ctaList.length > 0 ? ctaList[Math.floor(Math.random() * ctaList.length)] : '';
        const imgAttachment = (card.attachments || []).find(a => a.mimeType && a.mimeType.startsWith('image/')) || card.attachments?.[0];
        const preview = imgAttachment?.previews?.find(p => p.width >= 300 && p.width <= 600) || imgAttachment?.previews?.[0];

        results.push({
          selected: false,
          content: baseContent,
          commentText: wrappedLink ? `${cta} ${wrappedLink}`.trim() : '',
          imagePath: '',
          imageBase64: '',
          imageUrl: imgAttachment ? imgAttachment.url : '',
          thumbnailUrl: preview ? preview.url : (imgAttachment ? imgAttachment.url : ''),
          trelloCardId: card.id,
          trelloCardName: card.name,
          enableSchedule: false,
          scheduleType: 'exact',
          scheduledTime: '',
          delayHours: 0,
          delayMinutes: 30,
        });
      } catch (err) {
        console.error(`Lỗi xử lý thẻ "${card.name}":`, err);
      }
    }

    return results;
  });
}

module.exports = { register, getCTAConfig, downloadCardImageDirect };
