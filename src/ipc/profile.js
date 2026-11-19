const { ipcMain } = require('electron');
const { extractFacebookCookie, parseCookieString } = require('../cookie-extractor');
const { scanPages } = require('../page-handler');

// Track running browsers to synchronize them with profile updates
const runningBrowsers = new Map();
const launchingProfiles = new Set();
const launchingPromises = new Map();

/**
 * Đưa cửa sổ trình duyệt và tab chỉ định lên trước màn hình (Foreground)
 */
async function focusBrowserWindow(browser, page) {
  if (!browser) return;

  // 1. Bring tab to front & restore window state via CDP
  try {
    if (page && !page.isClosed()) {
      await page.bringToFront().catch(() => {});
      const session = await page.target().createCDPSession();
      try {
        const { windowId } = await session.send('Browser.getWindowForTarget');
        if (windowId) {
          // Khôi phục kích thước cửa sổ nếu đang bị minimize
          await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'normal' },
          });
          // Phóng to cửa sổ
          await session.send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'maximized' },
          });
        }
      } catch (err) {
      } finally {
        await session.detach().catch(() => {});
      }
    }
  } catch (e) {}

  // 2. Kích hoạt cửa sổ lên đầu màn hình trên Windows bằng Windows Shell AppActivate
  if (process.platform === 'win32') {
    try {
      const pid = browser.process()?.pid;
      if (pid) {
        const { exec } = require('child_process');
        exec(`powershell -NoProfile -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.AppActivate(${pid})"`);
      }
    } catch (e) {
      console.error('Lỗi kích hoạt cửa sổ trình duyệt:', e);
    }
  }
}

function notifyRunningProfiles() {
  try {
    const { getMainWindow } = require('./helpers');
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('profile:running_update', Array.from(runningBrowsers.keys()));
  } catch (e) {}
}

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

  ipcMain.handle('profile:update_token', async (_, { profileId, name, cookieString, metadata }) => {
    const profile = await db.getProfileById(profileId);
    if (!profile) {
      throw new Error('Profile does not exist.');
    }

    if (name) {
      await db.updateProfileName(profileId, name);
    }

    if (cookieString || metadata) {
      // If cookieString is empty but metadata exists, we pass profile.cookieString to keep the old cookie
      await db.updateCookieString(profileId, cookieString || profile.cookieString, metadata);
    }

    if (cookieString) {
      // Đồng bộ (Sync) cookie mới vào trình duyệt đang mở (nếu có)
      const active = runningBrowsers.get(profileId);
      if (active && active.targetPage) {
        try {
          const cookies = parseCookieString(cookieString);
          if (cookies.length > 0) {
            await active.targetPage.setCookie(...cookies);
            await active.targetPage.reload({ waitUntil: 'domcontentloaded' });
            pushStatus(`Đã đồng bộ Cookie mới vào trình duyệt đang mở của ${name || profile.name}`, 'info');
          }
        } catch (e) {
          console.error('Lỗi đồng bộ cookie vào trình duyệt đang mở:', e);
        }
      }

      pushStatus(`Token updated successfully.`, 'success');
    } else {
      pushStatus('Profile updated.', 'success');
    }

    return true;
  });

  ipcMain.handle('profile:update_page_name', async (_, { profileId, pageId, newName }) => {
    return await db.updatePageName(profileId, pageId, newName);
  });

  ipcMain.handle('profile:running_ids', () => {
    return Array.from(runningBrowsers.keys());
  });

  // Close only this profile's managed Chromium browser; keep its account and queue data.
  ipcMain.handle('profile:close', async (_, profileId) => {
    if (profileId === undefined || profileId === null) {
      throw new Error('Chưa chọn Profile cần đóng.');
    }
    const key = String(profileId);
    // If the browser is still launching, wait until its entry is ready to close.
    if (!runningBrowsers.has(key) && launchingPromises.has(key)) {
      await launchingPromises.get(key).catch(() => {});
    }
    const entry = runningBrowsers.get(key);
    if (!entry || !entry.browser || !entry.browser.isConnected()) {
      if (runningBrowsers.get(key) === entry && entry) {
        runningBrowsers.delete(key);
        notifyRunningProfiles();
      }
      return false;
    }
    try {
      await entry.browser.close();
    } finally {
      if (runningBrowsers.get(key) === entry) {
        runningBrowsers.delete(key);
        notifyRunningProfiles();
      }
    }
    pushStatus(`Đã đóng cửa sổ Profile: ${profileId}`, 'info');
    return true;
  });

  ipcMain.handle('profile:open', async (_, profileId) => {
    const key = String(profileId);
    const profile = await db.getProfileById(profileId);
    if (!profile) throw new Error('Profile does not exist.');

    // 1. Nếu đang trong tiến trình khởi chạy browser cho profile này, thông báo và đợi hoàn tất
    if (launchingProfiles.has(key)) {
      pushStatus(`Trình duyệt cho profile: ${profile.name} đang được khởi chạy, vui lòng đợi trong giây lát...`, 'info');
      if (launchingPromises.has(key)) {
        await launchingPromises.get(key).catch(() => {});
      }
      return true;
    }

    // 2. Nếu profile này đã có trình duyệt đang mở và còn kết nối tốt
    if (runningBrowsers.has(key)) {
      const active = runningBrowsers.get(key);
      if (active && active.initPromise) {
        await active.initPromise.catch(() => {});
      }
      if (active && active.browser && active.browser.isConnected()) {
        try {
          const pages = await active.browser.pages();
          let targetPage = active.targetPage && !active.targetPage.isClosed() ? active.targetPage : null;
          if (targetPage) {
            try {
              const u = (targetPage.url() || '').toLowerCase();
              if (u.startsWith('file://')) targetPage = null;
            } catch {
              targetPage = null;
            }
          }
          
          if (!targetPage && pages.length > 0) {
            targetPage = pages.find((p) => {
              try {
                const u = (p.url() || '').toLowerCase();
                return u.includes('facebook.com') && !u.includes('business.facebook.com');
              } catch {
                return false;
              }
            }) || pages.find((p) => {
              try {
                return !(p.url() || '').toLowerCase().startsWith('file://');
              } catch {
                return false;
              }
            }) || pages[0];
            active.targetPage = targetPage;
          }

          if (!targetPage || targetPage.isClosed()) {
            const { setWindowTitle } = require('../browser/BrowserLauncher');
            targetPage = await active.browser.newPage();
            await setWindowTitle(targetPage, profile.name);
            await targetPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
            active.targetPage = targetPage;
          }

          await focusBrowserWindow(active.browser, targetPage);
          pushStatus(`Đã chuyển sang trình duyệt đang mở của: ${profile.name}`, 'info');
          return true;
        } catch (e) {
          console.error('Lỗi khi kích hoạt trình duyệt đang mở:', e);
          runningBrowsers.delete(key);
          notifyRunningProfiles();
        }
      } else {
        runningBrowsers.delete(key);
        notifyRunningProfiles();
      }
    }

    launchingProfiles.add(key);
    pushStatus(`Mở trình duyệt cho profile: ${profile.name}...`, 'running');
    
    const initPromise = (async () => {
      const { launchStealthBrowser, setWindowTitle, getProfileUserDataDir } = require('../browser/BrowserLauncher');
      // Sử dụng userDataDir riêng cho mỗi profile để lưu vĩnh viễn cookies, IndexedDB và token bảo mật thiết bị
      const userDataDir = getProfileUserDataDir(profileId);
      const browser = await launchStealthBrowser({ headless: false, userDataDir });
      const [page] = await browser.pages();
      const targetPage = page || (await browser.newPage());
      
      await setWindowTitle(targetPage, profile.name);
      
      // Đăng ký ngay vào runningBrowsers để ngăn chặn mọi click mở trùng lặp
      const entry = { browser, targetPage, infoPage: null, initPromise: null };
      runningBrowsers.set(key, entry);
      notifyRunningProfiles();

      // Register disconnect immediately so closing during login also clears the running state.
      let syncInterval = null;
      browser.on('disconnected', () => {
        if (syncInterval) clearInterval(syncInterval);
        if (runningBrowsers.get(key) === entry) {
          runningBrowsers.delete(key);
          notifyRunningProfiles();
        }
        pushStatus(`Đã đóng trình duyệt của profile: ${profile.name}`, 'info');
      });

      // Hook for new tabs opened by the user
      browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
          const newPage = await target.page().catch(() => null);
          if (newPage) await setWindowTitle(newPage, profile.name);
        }
      });

      // Mở tab hiển thị thông tin tài khoản, 2FA và mã 2FA trực tiếp
      const { openProfileInfoTab } = require('../browser/ProfileInfoTab');
      let infoPage = null;
      try {
        infoPage = await openProfileInfoTab(browser, profile);
        await setWindowTitle(infoPage, `${profile.name} - 2FA & Info`);
        entry.infoPage = infoPage;
      } catch (infoErr) {
        console.error('Không thể mở tab thông tin profile:', infoErr);
      }
      
      // Chỉ nạp cookie từ DB nếu trình duyệt chưa có sẵn c_user & xs hợp lệ trong userDataDir
      const existingCookies = await targetPage.cookies('https://www.facebook.com').catch(() => []);
      const hasValidSessionCookies = existingCookies.some(c => c.name === 'c_user' && c.value) &&
                                     existingCookies.some(c => c.name === 'xs' && c.value);
      if (!hasValidSessionCookies) {
        const cookies = parseCookieString(profile.cookieString);
        if (cookies.length > 0) {
          await targetPage.setCookie(...cookies);
        }
      }

      const currentUrl = (targetPage.url() || '').toLowerCase();
      if (!currentUrl.includes('www.facebook.com') || currentUrl.includes('business.facebook.com')) {
        await targetPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
      }
      await focusBrowserWindow(browser, targetPage);
      pushStatus(`Đã mở trình duyệt cho profile: ${profile.name}.`, 'success');
      
      // Kiểm tra trạng thái đăng nhập sau khi load trang
      await new Promise(r => setTimeout(r, 3000));
      const { checkFacebookLoginState, autoLoginFacebook } = require('../login-handler/FacebookLogin');
      let loginCheck = await checkFacebookLoginState(targetPage, profile.metadata?.uid);

      if (!loginCheck.isLoggedIn && hasValidSessionCookies && profile.cookieString) {
        const fallbackCookies = parseCookieString(profile.cookieString);
        if (fallbackCookies.length > 0) {
          await targetPage.setCookie(...fallbackCookies);
          await targetPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
          await new Promise(r => setTimeout(r, 3000));
          loginCheck = await checkFacebookLoginState(targetPage, profile.metadata?.uid);
        }
      }

      if (!loginCheck.isLoggedIn) {
        if (profile.metadata?.uid && profile.metadata?.password) {
          pushStatus(`Phát hiện chưa đăng nhập. Bắt đầu tự động đăng nhập an toàn cho ${profile.name}...`, 'running');
          const loginOk = await autoLoginFacebook(targetPage, profile.metadata, pushStatus);
          if (loginOk) {
            try {
              const curCookies = await targetPage.cookies();
              if (curCookies && curCookies.length > 0) {
                const hasCUser = curCookies.some(c => c.name === 'c_user' && c.value);
                const hasXs = curCookies.some(c => c.name === 'xs' && c.value);
                if (hasCUser && hasXs) {
                  await db.updateCookieString(profileId, JSON.stringify(curCookies));
                  pushStatus(`Đã lưu phiên đăng nhập và Cookie mới cho ${profile.name}!`, 'success');
                }
              }
            } catch (e) {}
          }
        }
      } else {
        pushStatus(`Tài khoản ${profile.name} đã đăng nhập sẵn. Giữ nguyên phiên làm việc.`, 'info');
      }

      // Auto-sync cookies from running browser to DB every 10 seconds (CHỈ LƯU KHI CÓ c_user VÀ xs HỢP LỆ)
      if (!browser.isConnected()) {
        throw new Error('Trình duyệt Profile đã được đóng trong lúc khởi tạo.');
      }
      syncInterval = setInterval(async () => {
        try {
          const currentCookies = await targetPage.cookies();
          if (currentCookies && currentCookies.length > 0) {
            const hasCUser = currentCookies.some(c => c.name === 'c_user' && c.value);
            const hasXs = currentCookies.some(c => c.name === 'xs' && c.value);
            if (hasCUser && hasXs) {
              await db.updateCookieString(profileId, JSON.stringify(currentCookies));
            }
          }
        } catch (e) {
          // Ignore errors (e.g. page is closed)
        }
      }, 10000);

      return true;
    })();

    launchingPromises.set(key, initPromise);
    const activeEntry = runningBrowsers.get(key);
    if (activeEntry) activeEntry.initPromise = initPromise;

    try {
      return await initPromise;
    } catch (error) {
      pushStatus(`Lỗi khi mở trình duyệt: ${error.message}`, 'error');
      runningBrowsers.delete(key);
      notifyRunningProfiles();
      throw error;
    } finally {
      launchingProfiles.delete(key);
      launchingPromises.delete(key);
      const currentEntry = runningBrowsers.get(key);
      if (currentEntry) currentEntry.initPromise = null;
    }
  });

  ipcMain.handle('profile:export_excel', async (event, profileIds) => {
    try {
      const profiles = await db.getProfiles();
      let exportData = profiles;
      if (profileIds && Array.isArray(profileIds) && profileIds.length > 0) {
        const profileMap = new Map(profiles.map(p => [p.id, p]));
        exportData = profileIds.map(id => profileMap.get(id)).filter(Boolean);
      }

      if (exportData.length === 0) return null;

      const { dialog } = require('electron');
      const { filePath } = await dialog.showSaveDialog({
        title: 'Lưu file Excel',
        defaultPath: 'profiles_export.xlsx',
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
      });

      if (!filePath) return null;

      const XLSX = require('xlsx');
      const dataToExport = exportData.map((p, index) => {
        return {
          'STT': index + 1,
          'Tên Profile': p.name,
          'Danh mục': p.metadata?.category === 'adm' ? 'Admin' : p.metadata?.category === 'btv' ? 'BTV' : p.metadata?.category || '',
          'UID': p.metadata?.uid || '',
          'Mật khẩu': p.metadata?.password || '',
          '2FA': p.metadata?.twofa || '',
          'Email': p.metadata?.email || '',
          'Pass Email': p.metadata?.emailPass || '',
          'Cookie': p.metadata?.rawString || '',
          'Số Fanpage': p.pages ? p.pages.length : 0,
          'Ngày tạo': new Date(p.createdAt).toLocaleString('vi-VN')
        };
      });

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      
      // Auto adjust column widths
      const wscols = Object.keys(dataToExport[0] || {}).map(key => ({ wch: Math.max(key.length, 15) }));
      ws['!cols'] = wscols;

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Profiles');
      XLSX.writeFile(wb, filePath);

      return filePath;
    } catch (error) {
      console.error('Lỗi xuất Excel:', error);
      throw error;
    }
  });

  ipcMain.handle('profile:sync_sheets', async (event, { profileIds, webAppUrl }) => {
    try {
      const profiles = await db.getProfiles();
      let exportData = profiles;
      if (profileIds && Array.isArray(profileIds) && profileIds.length > 0) {
        const profileMap = new Map(profiles.map(p => [p.id, p]));
        exportData = profileIds.map(id => profileMap.get(id)).filter(Boolean);
      }

      if (exportData.length === 0) return { success: false, message: 'Không có dữ liệu để đồng bộ' };

      const dataToExport = exportData.map((p, index) => ({
        stt: index + 1,
        name: p.name,
        category: p.metadata?.category || '',
        uid: p.metadata?.uid || '',
        password: p.metadata?.password || '',
        twofa: p.metadata?.twofa || '',
        email: p.metadata?.email || '',
        emailPass: p.metadata?.emailPass || '',
        cookie: p.metadata?.rawString || '',
        pagesCount: p.pages ? p.pages.length : 0,
        createdAt: new Date(p.createdAt).toLocaleString('vi-VN')
      }));

      // In Electron Node process, we can use built-in fetch
      const response = await fetch(webAppUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ profiles: dataToExport })
      });

      // Google Apps Script usually returns a 302 redirect for POST requests,
      // but fetch() follows redirects automatically.
      const resultText = await response.text();
      let result = {};
      try {
        result = JSON.parse(resultText);
      } catch {
        result = { status: 'success', message: 'Đã gửi yêu cầu (không thể phân tích phản hồi JSON)' };
      }

      if (result.status === 'error') {
        throw new Error(result.message || 'Lỗi không xác định từ Google Sheets');
      }

      return { success: true, message: result.message || 'Đồng bộ thành công' };
    } catch (error) {
      console.error('Lỗi đồng bộ Google Sheets:', error);
      throw error;
    }
  });
}

module.exports = {
  register,
  runningBrowsers,
  launchingProfiles,
  launchingPromises,
  focusBrowserWindow,
  notifyRunningProfiles,
};
