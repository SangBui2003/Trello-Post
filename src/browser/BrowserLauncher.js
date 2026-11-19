const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Apply stealth evasions (navigator.webdriver, chrome.runtime, plugins, etc.)
puppeteer.use(StealthPlugin());

/**
 * Tìm đường dẫn thực thi của Chromium.
 * Dev: Tìm trong puppeteer cache.
 * Production: Tìm trong resources/chromium/.
 */
function getChromiumPath() {
  const { app } = require('electron');

  if (!app.isPackaged) {
    // Dev: tự tìm trong cache
    const os = require('os');
    const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
    
    if (fs.existsSync(cacheDir)) {
      const versions = fs.readdirSync(cacheDir)
        .filter(f => f.startsWith('win64-'))
        .sort().reverse();
      
      for (const ver of versions) {
        for (const dir of ['chrome-win64', 'chrome-win']) {
          const exe = path.join(cacheDir, ver, dir, 'chrome.exe');
          if (fs.existsSync(exe)) return exe;
        }
      }
    }
  }

  // Production: đã copy vào resources/chromium/ (bởi electron-builder extraResources)
  const prodExe = path.join(process.resourcesPath, 'chromium', 'chrome.exe');
  if (fs.existsSync(prodExe)) return prodExe;

  // Fallback sang Chrome hệ thống
  const commonPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

// Args giả lập trình duyệt thật, tránh bị detect là headless/bot
const STEALTH_ARGS = [
  '--test-type',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-pings',
  '--password-store=basic',
  '--disable-autofill',
  '--disable-notifications',
  '--disable-popup-blocking',
  '--disable-features=TranslateUI,BlinkGenPropertyTrees,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,BackForwardCache',
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-default-apps',
  '--mute-audio',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-ipc-flooding-protection',
  '--disable-client-side-phishing-detection',
  '--disable-hang-monitor',
  '--disable-prompt-on-repost',
  '--metrics-recording-only',

  // Giả lập GPU và WebGL thật
  '--enable-webgl',

  // Realistic window size and state
  '--window-position=0,0',
  '--force-device-scale-factor=1.1',
];

/**
 * Lấy thư mục dữ liệu trình duyệt riêng biệt cho từng profile để lưu phiên đăng nhập lâu dài.
 * Tránh việc mỗi lần mở là một trình duyệt mới toanh khiến Facebook nghi ngờ và ép đăng xuất.
 */
function getProfileUserDataDir(profileId) {
  if (!profileId) return undefined;
  try {
    const { app } = require('electron');
    const baseDir = path.join(app.getPath('userData'), 'browser_profiles');
    const dir = path.join(baseDir, `profile_${profileId}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  } catch (err) {
    console.error('Không thể tạo userDataDir cho profile:', err);
    return undefined;
  }
}

/**
 * Launch trình duyệt với stealth plugin + anti-fingerprint config.
 * Drop-in replacement cho `puppeteer.launch()`.
 *
 * @param {Object} options - Tuỳ chọn bổ sung cho puppeteer.launch
 * @param {boolean} [options.headless] - Chạy headless hay không (default: false)
 * @param {Object} [options.defaultViewport] - Viewport config (default: null = full window)
 * @param {string[]} [options.extraArgs] - Thêm args tuỳ chỉnh
 * @returns {Promise<Browser>}
 */
async function launchStealthBrowser({
  headless = false,
  defaultViewport = null,
  extraArgs = [],
  userDataDir = undefined,
} = {}) {
  const options = {
    headless,
    defaultViewport,
    userDataDir,
    args: [...STEALTH_ARGS, ...extraArgs],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  // Tự động tìm executablePath (Flexible: Dev vs Production)
  const chromiumPath = getChromiumPath();
  if (chromiumPath) {
    options.executablePath = chromiumPath;
    console.log('Using browser at:', chromiumPath);
  }

  const browser = await puppeteer.launch(options);
  
  // Force maximize using Chrome DevTools Protocol (CDP)
  // Cách này uy tín hơn --start-maximized vì nó gọi lệnh trực tiếp vào browser engine
  try {
    const pages = await browser.pages();
    if (pages.length > 0) {
      const session = await pages[0].target().createCDPSession();
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', { 
        windowId, 
        bounds: { windowState: 'maximized' } 
      });
      await session.detach();
    }
  } catch (e) {
    console.error('Không thể ép phóng to qua CDP:', e);
  }

  return browser;
}

async function setWindowTitle(page, prefix) {
  if (!page || !prefix) return;
  const initTitleHelper = (p) => {
    window.__postpilotTitlePrefix = p;
    if (window.__postpilotTitleObserverAttached) {
      if (typeof window.__postpilotUpdateTitle === 'function') {
        window.__postpilotUpdateTitle();
      }
      return;
    }
    window.__postpilotTitleObserverAttached = true;

    let isUpdating = false;
    const updateTitle = () => {
      if (isUpdating) return;
      const activePrefix = window.__postpilotTitlePrefix;
      if (!activePrefix) return;
      const t = document.title || '';
      const expectedStart = `[${activePrefix}]`;
      if (t.startsWith(expectedStart)) return;

      const cleanTitle = t.replace(/^(\[[^\]]*\]\s*)+/, '').trim();
      if (cleanTitle) {
        isUpdating = true;
        document.title = `${expectedStart} ${cleanTitle}`;
        isUpdating = false;
      } else if (document.readyState === 'complete') {
        isUpdating = true;
        document.title = `${expectedStart} Facebook`;
        isUpdating = false;
      }
    };

    window.__postpilotUpdateTitle = updateTitle;

    const attachObserver = () => {
      updateTitle();
      const head = document.querySelector('head');
      if (head && !window.__postpilotHeadObserved) {
        window.__postpilotHeadObserved = true;
        new MutationObserver(updateTitle).observe(head, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    };

    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
    } else {
      attachObserver();
    }

    setInterval(updateTitle, 2000);
  };

  await page.evaluateOnNewDocument(initTitleHelper, prefix).catch(() => {});
  await page.evaluate(initTitleHelper, prefix).catch(() => {});
}

module.exports = { launchStealthBrowser, setWindowTitle, getProfileUserDataDir };
