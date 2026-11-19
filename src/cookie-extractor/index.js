const { launchStealthBrowser } = require('../browser/BrowserLauncher');

async function extractFacebookCookie(existingCookies = null) {
  let browser;
  try {
    browser = await launchStealthBrowser({ headless: false });
    
    const [page] = await browser.pages();
    const targetPage = page || (await browser.newPage());
    
    if (existingCookies && existingCookies.length > 0) {
      await targetPage.setCookie(...existingCookies);
    }

    await targetPage.bringToFront();
    
    await targetPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    
    // Đợi người dùng tự đăng nhập và Facebook chuyển hướng về trang chủ
    await targetPage.waitForFunction(
      () => {
        return document.querySelector('div[role="navigation"]') !== null &&
               !window.location.href.includes('/login');
      },
      { timeout: 300000 } // Chờ tối đa 5 phút
    );
    
    // Thêm một khoảng trễ nhỏ để đảm bảo tất cả cookie được thiết lập
    await new Promise(r => setTimeout(r, 2000));
    
    const cookies = await targetPage.cookies();
    const cookieString = JSON.stringify({ cookies });
    
    await browser.close();
    return cookieString;
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    throw error;
  }
}

function parseCookieString(cookieString) {
  if (!cookieString) return [];
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
        httpOnly: cookie.httpOnly !== undefined ? cookie.httpOnly : ['xs', 'datr', 'sb', 'fr'].includes(cookie.name),
        secure: cookie.secure !== undefined ? cookie.secure : true,
        sameSite: cookie.sameSite || 'None',
        expires: cookie.expires || (Math.floor(Date.now() / 1000) + 365 * 86400),
      }));
    }
  } catch {
    const cookiePairs = cookieString.split(';').map((pair) => pair.trim()).filter(Boolean);
    cookies = cookiePairs
      .map((pair) => {
        const splitIndex = pair.indexOf('=');
        if (splitIndex === -1) return null;
        const name = pair.slice(0, splitIndex).trim();
        const value = pair.slice(splitIndex + 1).trim();
        return {
          name,
          value,
          domain: '.facebook.com',
          path: '/',
          httpOnly: ['xs', 'datr', 'sb', 'fr'].includes(name),
          secure: true,
          sameSite: 'None',
          expires: Math.floor(Date.now() / 1000) + 365 * 86400,
        };
      })
      .filter((cookie) => cookie && cookie.name);
  }
  return cookies;
}

async function injectCookies(page, cookieString) {
  const cookies = parseCookieString(cookieString);
  if (cookies.length > 0) {
    await page.setCookie(...cookies);
  }
}

module.exports = { extractFacebookCookie, parseCookieString, injectCookies };
