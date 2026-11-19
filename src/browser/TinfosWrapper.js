const path = require('path');
const fs = require('fs');
const { launchStealthBrowser } = require('./BrowserLauncher');

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let wrapLinkPromiseChain = Promise.resolve();

function getUserDataPath() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch (e) {}
  return path.join(process.env.APPDATA || '', 'Trello PostPilot');
}

/**
 * Lấy cookie Tinfos đã lưu từ file tinfos_cookies.json
 */
function getSavedTinfosCookies() {
  const cookiePath = path.join(getUserDataPath(), 'tinfos_cookies.json');
  if (fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      if (Array.isArray(cookies) && cookies.length > 0) {
        return cookies;
      }
    } catch (e) {
      console.error('[Tinfos] Không thể đọc file cookie:', e.message);
    }
  }
  return [];
}

/**
 * Rút gọn / Wrap link qua API chính thức của Dash Tinfosmedia
 * Tốc độ cực nhanh (~0.3s), không cần khởi động browser puppeteer
 */
async function _wrapLinkViaApi(originalLink, cleanDomain) {
  const cookies = getSavedTinfosCookies();
  if (!cookies || cookies.length === 0) {
    throw new Error('Chưa đăng nhập Tinfosmedia. Vui lòng vào Cài đặt -> Đăng Nhập Tinfos.');
  }

  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  console.log(`[Tinfos API] Gửi yêu cầu tạo link: dest=${originalLink}, domain=${cleanDomain}`);
  const response = await fetch('https://dash.tinfosmedia.com/api/link-wrapper/create-link', {
    method: 'POST',
    headers: {
      'Cookie': cookieHeader,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    },
    body: JSON.stringify({
      dest: originalLink,
      domain: cleanDomain
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (response.status === 401) {
    throw new Error('Chưa đăng nhập Tinfosmedia hoặc phiên đăng nhập đã hết hạn (401). Vui lòng vào Cài đặt -> Đăng Nhập Tinfos.');
  }

  if (response.status === 200) {
    const json = await response.json();
    if (json.success && json.slug) {
      const wrappedUrl = `https://${cleanDomain}/posts/${json.slug}`;
      console.log(`[Tinfos API] Tạo link thành công: ${wrappedUrl}`);
      return wrappedUrl;
    } else {
      console.warn(`[Tinfos API] Phản hồi không thành công (${json.message || 'unknown'}). Sử dụng link gốc.`);
      // Trả về link gốc nếu Tinfos từ chối link (ví dụ Only .cafe destinations are allowed)
      return originalLink;
    }
  }

  throw new Error(`Tinfos API trả về mã lỗi HTTP ${response.status}`);
}

/**
 * Phương thức dự phòng sử dụng Browser nếu API gặp sự cố mạng bất thường
 */
async function _wrapLinkViaBrowser(originalLink, cleanDomain) {
  const userDataDir = path.join(getUserDataPath(), 'tinfos_session');
  let browser = null;

  try {
    browser = await launchStealthBrowser({
      headless: true,
      defaultViewport: null,
      userDataDir,
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();

    const cookies = getSavedTinfosCookies();
    if (cookies.length > 0) {
      await page.setCookie(...cookies);
    }

    await page.bringToFront();
    console.log('[Tinfos Browser] Điều hướng đến dash.tinfosmedia.com/link-wrapper...');
    await page.goto('https://dash.tinfosmedia.com/link-wrapper', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Kiểm tra nhanh input destination
    const destSelector = '#dest, input[name="dest"], input[placeholder*="destination" i]';
    await page.waitForSelector(destSelector, { timeout: 10000 });

    // Điền destination URL và domain qua DOM React-safe
    await page.evaluate((link, domain) => {
      const setVal = (el, val) => {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const destInput = document.querySelector('#dest') || document.querySelector('input[placeholder*="destination" i]');
      setVal(destInput, link);

      const domainInput = document.querySelector('#domain') || document.querySelector('input[placeholder*="domain" i], input[placeholder="example.com"]');
      if (domainInput && domain) {
        setVal(domainInput, domain);
      }
    }, originalLink, cleanDomain);

    await delay(500);

    // Bắt đầu lắng nghe response của create-link API để lấy kết quả ngay tức khắc
    const responsePromise = page.waitForResponse(
      res => res.url().includes('/api/link-wrapper/create-link'),
      { timeout: 12000 }
    ).catch(() => null);

    // Click nút Wrap an toàn qua DOM click
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
      const wrapBtn = btns.find(b => (b.innerText || '').trim().toLowerCase() === 'wrap');
      if (wrapBtn) {
        wrapBtn.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      console.warn('[Tinfos Browser] Không tìm thấy nút Wrap, dùng link gốc.');
      return originalLink;
    }

    const res = await responsePromise;
    if (res) {
      try {
        const json = await res.json();
        if (json.success && json.slug) {
          return `https://${cleanDomain}/posts/${json.slug}`;
        }
      } catch (e) {}
    }

    return originalLink;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function extractCleanDomain(domain) {
  if (!domain) return '';
  return String(domain)
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0]
    .trim();
}

function getSavedTinfosConfig() {
  const configPath = path.join(getUserDataPath(), 'tinfos-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg && typeof cfg === 'object') return cfg;
    } catch (e) {}
  }
  return {};
}

function isAlreadyTargetDomain(link, cleanDomain) {
  if (!link || !cleanDomain) return false;
  try {
    const u = new URL(link);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const target = cleanDomain.toLowerCase().replace(/^www\./, '');
    return host === target;
  } catch {
    return link.toLowerCase().includes(cleanDomain.toLowerCase());
  }
}

/**
 * Xử lý wrap link nội bộ
 */
async function _wrapLinkInternal(originalLink, domain = '') {
  if (!originalLink) return '';

  const cfg = getSavedTinfosConfig();
  const rawDomain = (domain && String(domain).trim()) || cfg.domain || '';
  const cleanDomain = extractCleanDomain(rawDomain);

  if (!cleanDomain) {
    console.warn('[Tinfos] Chưa cấu hình đầu web (Domain). Giữ nguyên link gốc:', originalLink);
    return originalLink;
  }

  // 1. Kiểm tra nếu link đã thuộc domain mục tiêu (đã bọc đúng đầu web cấu hình) -> Giữ nguyên ngay lập tức
  if (isAlreadyTargetDomain(originalLink, cleanDomain)) {
    console.log(`[Tinfos] Link đã thuộc định dạng đầu web mục tiêu ("${cleanDomain}"): ${originalLink}`);
    return originalLink;
  }

  // 2. Thử tạo link qua Direct REST API (nhanh nhất, ~0.3s)
  try {
    return await _wrapLinkViaApi(originalLink, cleanDomain);
  } catch (apiErr) {
    if (apiErr.message && apiErr.message.includes('Chưa đăng nhập')) {
      throw apiErr;
    }
    console.warn('[Tinfos] Không thể wrap qua API trực tiếp, thử fallback qua Browser:', apiErr.message);
  }

  // 3. Fallback qua Browser có giới hạn thời gian nghiêm ngặt
  try {
    return await _wrapLinkViaBrowser(originalLink, cleanDomain);
  } catch (browserErr) {
    console.error('[Tinfos] Cả hai phương thức wrap link đều thất bại:', browserErr.message);
    return originalLink;
  }
}

/**
 * Hàm wrapLink công khai (dùng promise chain tuần tự)
 */
async function wrapLink(originalLink, domain = '') {
  const execute = () => _wrapLinkInternal(originalLink, domain);
  const promise = wrapLinkPromiseChain.then(execute, execute);
  wrapLinkPromiseChain = promise.catch(() => {});
  return promise;
}

/**
 * Đăng nhập Tinfosmedia
 */
async function loginTinfos() {
  const userDataDir = path.join(getUserDataPath(), 'tinfos_session');
  const browser = await launchStealthBrowser({
    headless: false,
    defaultViewport: null,
    userDataDir,
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  const cookiePath = path.join(getUserDataPath(), 'tinfos_cookies.json');
  // Load existing cookies
  if (fs.existsSync(cookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      if (cookies && cookies.length > 0) {
        await page.setCookie(...cookies);
      }
    } catch (e) {}
  }

  await page.bringToFront();
  await page.goto('https://dash.tinfosmedia.com/sign-in', { waitUntil: 'domcontentloaded' });

  const saveCookies = async () => {
    try {
      if (browser.isConnected() && !page.isClosed()) {
        const cookies = await page.cookies();
        if (cookies && cookies.length > 0) {
          fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
        }
      }
    } catch (e) {}
  };

  // Lưu cookies mỗi khi chuyển trang (ví dụ đăng nhập thành công vào trang dashboard)
  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      await saveCookies();
    }
  });

  // Lưu cookies định kỳ mỗi 3 giây khi cửa sổ đang mở
  const interval = setInterval(saveCookies, 3000);

  browser.on('disconnected', async () => {
    clearInterval(interval);
  });
}

module.exports = { wrapLink, loginTinfos };
