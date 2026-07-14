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
  '--no-sandbox',
  '--disable-setuid-sandbox',
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
  '--disable-features=TranslateUI,BlinkGenPropertyTrees', // Remove Translation and other UI bars
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-default-apps',
  '--mute-audio',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-client-side-phishing-detection',
  '--disable-hang-monitor',
  '--disable-prompt-on-repost',
  '--metrics-recording-only',
  '--test-type',

  // Giả lập GPU và WebGL thật
  '--enable-webgl',
  '--use-gl=swiftshader',

  // Realistic window size and state
  '--window-position=0,0',
  '--force-device-scale-factor=1.1',
];

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

  // Xoá thuộc tính navigator.webdriver trên mọi page mới
  browser.on('targetcreated', async (target) => {
    const page = await target.page().catch(() => null);
    if (!page) return;

    await page.evaluateOnNewDocument(() => {
      // Override navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Override permissions query
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery(parameters);
      };

      // Override plugins to look real
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['vi-VN', 'vi', 'en-US', 'en'],
      });
    }).catch(() => {});
  });

  return browser;
}

module.exports = { launchStealthBrowser };
