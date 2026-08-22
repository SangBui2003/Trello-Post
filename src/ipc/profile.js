const { ipcMain } = require('electron');
const { extractFacebookCookie } = require('../cookie-extractor');
const { scanPages, syncGroups } = require('../page-handler');

// Track running browsers to synchronize them with profile updates
const runningBrowsers = new Map();

/**
 * @param {{ pushStatus: Function, db: Object }} ctx
 */
function register(ctx) {
  const { pushStatus, db } = ctx;

  ipcMain.handle('profile:list', async () => {
    return await db.getProfiles();
  });

  ipcMain.handle('profile:delete', async (_, id) => {
    return await db.deleteProfile(id);
  });

  ipcMain.handle('profile:start_login', async (_, profileId) => {
    // If a browser is already running for this profile, use it!
    if (profileId && runningBrowsers.has(profileId)) {
      const active = runningBrowsers.get(profileId);
      if (active && active.targetPage) {
        pushStatus('Đang lấy cookie từ trình duyệt đã mở...', 'info');
        try {
          await active.targetPage.bringToFront();
          const cookies = await active.targetPage.cookies();
          pushStatus('Đã lấy cookie từ trình duyệt đang chạy.', 'success');
          return JSON.stringify({ cookies });
        } catch (e) {
          console.error(e);
        }
      }
    }

    pushStatus('Opening browser for login to save new Profile... (Max 5 minutes)', 'running');

    try {
      let existingCookies = null;
      if (profileId) {
        const profile = await db.getProfileById(profileId);
        if (profile && profile.cookieString) {
          existingCookies = parseCookieString(profile.cookieString);
        }
      }
      const cookieString = await extractFacebookCookie(existingCookies);
      pushStatus('Cookies extracted successfully. Please enter a name and save.', 'success');
      return cookieString;
    } catch (error) {
      pushStatus('Failed or login cancelled.', 'error');
      throw error;
    }
  });

  ipcMain.handle('profile:save', async (_, payload) => {
    const profile = await db.addProfile(payload);

    if (payload.cookieString) {
      pushStatus('Scanning Fanpages...', 'running');

      try {
        const pages = await scanPages(payload.cookieString);
        if (pages.length > 0) {
          await db.updateProfilePages(profile.id, pages);
          profile.pages = pages;
          pushStatus(`Found ${pages.length} Fanpages.`, 'success');
        } else {
          pushStatus('No Fanpages found or account has no pages.', 'info');
        }
      } catch (error) {
        pushStatus(`Fanpage scan error: ${error.message}`, 'error');
      }
    }

    return profile;
  });

  ipcMain.handle('profile:scan_pages', async (_, profileId) => {
    const profile = await db.getProfileById(profileId);
    if (!profile) {
      throw new Error('Profile does not exist.');
    }

    pushStatus('Rescanning Fanpages...', 'running');

    try {
      const pages = await scanPages(profile.cookieString);
      await db.updateProfilePages(profileId, pages);
      pushStatus(`Scan complete: ${pages.length} Fanpages.`, 'success');
      return pages;
    } catch (error) {
      pushStatus(`Lỗi quét Fanpage: ${error.message}`, 'error');
      throw error;
    }
  });

  ipcMain.handle('profile:get_pages', async (_, profileId) => {
    return await db.getProfilePages(profileId);
  });

  ipcMain.handle('profile:update_token', async (_, { profileId, cookieString }) => {
    const profile = await db.getProfileById(profileId);
    if (!profile) {
      throw new Error('Profile does not exist.');
    }

    await db.updateCookieString(profileId, cookieString);

    // Đồng bộ (Sync) cookie mới vào trình duyệt đang mở (nếu có)
    const active = runningBrowsers.get(profileId);
    if (active && active.targetPage) {
      try {
        const cookies = parseCookieString(cookieString);
        if (cookies.length > 0) {
          await active.targetPage.setCookie(...cookies);
          await active.targetPage.reload({ waitUntil: 'domcontentloaded' });
          pushStatus(`Đã đồng bộ Cookie mới vào trình duyệt đang mở của ${profile.name}`, 'info');
        }
      } catch (e) {
        console.error('Lỗi đồng bộ cookie vào trình duyệt đang mở:', e);
      }
    }

    // Re-scan pages với token mới
    pushStatus('Token updated. Rescanning Fanpages...', 'running');
    try {
      const pages = await scanPages(cookieString);
      await db.updateProfilePages(profileId, pages);
      pushStatus(`Token updated & scan complete: ${pages.length} Fanpages.`, 'success');
    } catch (error) {
      pushStatus(`Token updated but Fanpage scan failed: ${error.message}`, 'error');
    }

    return true;
  });

  ipcMain.handle('profile:update_page_name', async (_, { profileId, pageId, newName }) => {
    return await db.updatePageName(profileId, pageId, newName);
  });

  ipcMain.handle('profile:open', async (_, profileId) => {
    const profile = await db.getProfileById(profileId);
    if (!profile) throw new Error('Profile does not exist.');

    pushStatus(`Mở trình duyệt cho profile: ${profile.name}...`, 'running');
    
    try {
      const { launchStealthBrowser } = require('../browser/BrowserLauncher');
      const browser = await launchStealthBrowser({ headless: false });
      const [page] = await browser.pages();
      const targetPage = page || (await browser.newPage());
      
      const cookies = parseCookieString(profile.cookieString);

      if (cookies.length > 0) {
        await targetPage.setCookie(...cookies);
      }

      await targetPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
      await targetPage.bringToFront();
      
      runningBrowsers.set(profileId, { browser, targetPage });
      pushStatus(`Đã mở trình duyệt cho profile: ${profile.name}.`, 'success');
      
      // Auto-sync cookies from running browser to DB every 10 seconds
      const syncInterval = setInterval(async () => {
        try {
          const currentCookies = await targetPage.cookies();
          if (currentCookies && currentCookies.length > 0) {
            await db.updateCookieString(profileId, JSON.stringify(currentCookies));
          }
        } catch (e) {
          // Ignore errors (e.g. page is closed)
        }
      }, 10000);

      browser.on('disconnected', () => {
        clearInterval(syncInterval);
        runningBrowsers.delete(profileId);
        pushStatus(`Đã đóng trình duyệt của profile: ${profile.name}`, 'info');
      });

      return true;
    } catch (error) {
      pushStatus(`Lỗi khi mở trình duyệt: ${error.message}`, 'error');
      throw error;
    }
  });
}

function parseCookieString(cookieString) {
  let cookies = [];
  try {
    const parsed = JSON.parse(cookieString);
    const cookieArray = Array.isArray(parsed) ? parsed : parsed.cookies || [];
    if (cookieArray.length > 0) {
      cookies = cookieArray.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || '.facebook.com',
        path: cookie.path || '/',
      }));
    }
  } catch {
    const cookiePairs = cookieString.split(';').map((pair) => pair.trim()).filter(Boolean);
    cookies = cookiePairs
      .map((pair) => {
        const splitIndex = pair.indexOf('=');
        if (splitIndex === -1) return null;
        return {
          name: pair.slice(0, splitIndex).trim(),
          value: pair.slice(splitIndex + 1).trim(),
          domain: '.facebook.com',
          path: '/',
        };
      })
      .filter((cookie) => cookie && cookie.name);
  }
  return cookies;
}

module.exports = { register };
