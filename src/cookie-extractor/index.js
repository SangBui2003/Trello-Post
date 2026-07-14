const { launchStealthBrowser } = require('../browser/BrowserLauncher');

async function extractFacebookCookie() {
  let browser;
  try {
    browser = await launchStealthBrowser();
    
    const [page] = await browser.pages();
    const targetPage = page || (await browser.newPage());
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

module.exports = { extractFacebookCookie };
