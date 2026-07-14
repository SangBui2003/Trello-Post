const { t } = require('../utils/i18n');
const { launchStealthBrowser } = require('../browser/BrowserLauncher');

class PageScanner {
  /**
   * Quét danh sách Fanpage mà tài khoản Facebook đang quản lý.
   * @param {string} cookieString - Cookie JSON string từ profile
   * @returns {Promise<Array<{pageName: string, pageUrl: string}>>}
   */
  async scanPages(cookieString) {
    let browser;
    try {
      browser = await launchStealthBrowser({
        headless: 'new', // Chuyển về headless vì đã quét đúng, chỉ cần fix text
        defaultViewport: null,
      });

      const page = await browser.newPage();
      await this._injectCookies(page, cookieString);

      console.log(t('backend.status.accessing_pages'));
      await page.goto('https://www.facebook.com/pages/?category=your_pages', {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      await new Promise((r) => setTimeout(r, 6000));

      // Scroll để đảm bảo load hết
      await page.evaluate(async () => {
        window.scrollBy(0, 1000);
        await new Promise(r => setTimeout(r, 1000));
        window.scrollBy(0, 1000);
      });

      const pages = await page.evaluate(() => {
        const results = [];
        const seenUrls = new Set();

        const blacklist = [
          'tin nhắn', 'messages', 'thông báo', 'notifications',
          'trang chủ', 'home', 'video', 'marketplace',
          'nhóm', 'groups', 'gaming', 'watch',
          'bạn bè', 'friends', 'sự kiện', 'events',
          'tạo', 'create', 'xem thêm', 'see more',
          'quảng cáo', 'ads', 'meta business',
          'cài đặt', 'settings', 'trợ giúp', 'help',
          'đăng xuất', 'log out', 'trang', 'pages',
          'quyền riêng tư', 'privacy', 'điều khoản', 'terms',
          'quản lý trang', 'manage pages', 'chuyển đổi', 'switch',
          'tìm kiếm', 'search', 'menu', 'trang của bạn', 'your pages'
        ].map(t => t.toLowerCase());

        const noiseSubstrings = [
          'ảnh đại diện', 'profile picture', 'avatar'
        ].map(t => t.toLowerCase());

        const systemSegments = [
          'pages', 'groups', 'settings', 'help', 'policies', 'login', 'marketplace',
          'watch', 'gaming', 'events', 'friends', 'notifications', 'messages',
          'bookmarks', 'ads', 'business', 'privacy', 'search', 'home'
        ];

        const mainContent = document.querySelector('div[role="main"]') || document.body;
        const links = Array.from(mainContent.querySelectorAll('a[href*="facebook.com/"]'));

        for (const a of links) {
          try {
            const href = a.href;
            const urlObj = new URL(href);
            let pathname = urlObj.pathname.toLowerCase().replace(/\/$/, '');
            if (!pathname.startsWith('/')) pathname = '/' + pathname;
            const segments = pathname.split('/').filter(Boolean);

            const isSlug = segments.length === 1 && !segments[0].includes('.');
            const isProfileId = segments[0] === 'profile.php' && urlObj.searchParams.has('id');
            const isNumberedPage = segments.length === 2 && segments[0] === 'pages';

            if (!isSlug && !isProfileId && !isNumberedPage) continue;
            if (segments.length > 0 && systemSegments.includes(segments[0]) && segments[0] !== 'profile.php' && segments[0] !== 'pages') continue;

            // --- TRÍCH XUẤT TÊN PAGE CHÍNH XÁC ---
            let name = '';
            
            // 1. Ưu tiên lấy text hiển thị TRÊN màn hình (visible text)
            // Lấy tất cả text node con, lọc bỏ rác
            const visibleTexts = a.innerText.trim().split('\n').map(t => t.trim()).filter(t => t.length > 1);
            
            for (const t of visibleTexts) {
              const tLower = t.toLowerCase();
              // Bỏ qua blacklist
              if (blacklist.includes(tLower)) continue;
              // Bỏ qua nếu chứa từ khoá "ảnh đại diện"
              if (noiseSubstrings.some(noise => tLower.includes(noise))) continue;
              
              name = t;
              break; 
            }

            // 2. Nếu vẫn không thấy, thử tìm trong heading gần đó (thường Page name nằm trong h2/h3 hoặc span font-bold)
            if (!name) {
              const card = a.closest('div[role="article"]') || a.parentElement;
              const heading = card?.querySelector('h1, h2, h3, h4, role["heading"], strong, b');
              if (heading) {
                const hText = heading.innerText.trim();
                if (hText && !blacklist.includes(hText.toLowerCase()) && !noiseSubstrings.some(n => hText.toLowerCase().includes(n))) {
                  name = hText;
                }
              }
            }

            // 3. Cuối cùng mới dùng aria-label nhưng phải lọc rác
            if (!name) {
              const aria = a.getAttribute('aria-label');
              if (aria) {
                const aLower = aria.toLowerCase();
                if (!blacklist.includes(aLower) && !noiseSubstrings.some(n => aLower.includes(n))) {
                  name = aria;
                }
              }
            }

            if (!name || name.length < 2) continue;

            // Chuẩn hoá URL
            let cleanUrl = urlObj.origin + urlObj.pathname;
            if (urlObj.searchParams.has('id')) {
              cleanUrl += '?id=' + urlObj.searchParams.get('id');
            } else if (!cleanUrl.endsWith('/')) {
              cleanUrl += '/';
            }

            if (seenUrls.has(cleanUrl)) continue;

            results.push({
              pageName: name,
              pageUrl: cleanUrl
            });
            seenUrls.add(cleanUrl);

          } catch (e) {}
        }

        return results;
      });

      await browser.close();
      return pages;
    } catch (error) {
      if (browser) await browser.close().catch(() => {});
      console.error('PageScanner error:', error.message);
      return [];
    }
  }

  async _injectCookies(page, cookieString) {
    let cookies = [];
    try {
      const parsed = JSON.parse(cookieString);
      const cookieArray = Array.isArray(parsed) ? parsed : (parsed.cookies || []);
      if (cookieArray.length > 0) {
        cookies = cookieArray.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.facebook.com',
          path: c.path || '/',
        }));
      }
    } catch {
      const cookiePairs = cookieString.split(';').map((p) => p.trim()).filter(Boolean);
      cookies = cookiePairs.map((pair) => {
        const splitIdx = pair.indexOf('=');
        if (splitIdx === -1) return null;
        return {
          name: pair.slice(0, splitIdx).trim(),
          value: pair.slice(splitIdx + 1).trim(),
          domain: '.facebook.com',
          path: '/',
        };
      }).filter((c) => c && c.name);
    }

    if (cookies.length > 0) {
      await page.setCookie(...cookies);
    }
  }
}

module.exports = PageScanner;
