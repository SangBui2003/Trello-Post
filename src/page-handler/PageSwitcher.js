const { t } = require('../utils/i18n');
const { delay } = require('../post-group/utils/helpers');

class PageSwitcher {
  /**
   * Switch account identity to corresponding Fanpage.
   * 
   * @param {import('puppeteer').Page} page - Puppeteer Page object
   * @param {string} pageUrl - Target Fanpage URL
   * @param {Function} onStatus - Status update callback
   */
  async switchIdentity(page, pageUrl, onStatus = () => {}) {
    onStatus(t('backend.status.switching_identity'));

    const targetIdMatch = (pageUrl || '').match(/[?&]id=(\d+)|facebook\.com\/(\d{10,})/i);
    const targetPageId = targetIdMatch ? (targetIdMatch[1] || targetIdMatch[2]) : null;

    const isMatchingIdentity = (cookies) => {
      if (!cookies || !cookies.iUser || cookies.iUser === cookies.cUser) return false;
      if (targetPageId) return cookies.iUser === targetPageId;
      return true;
    };

    // Early check: nếu cookie đã thể hiện đang dùng đúng danh tính Fanpage thì bỏ qua bước chuyển
    const initialCookies = await this._getIdentityCookies(page);
    if (isMatchingIdentity(initialCookies)) {
      onStatus(t('backend.status.already_fanpage') + ' (Early Cookie Check)', 'success');
      return true;
    }

    // 1. Chỉ điều hướng nếu tab chưa ở đúng URL Fanpage
    if (!this._isAtTargetPage(page.url(), pageUrl, targetPageId)) {
      onStatus(t('backend.status.accessing_page_url', {url: pageUrl}));
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await delay(2000);
    } else {
      await delay(1000);
    }

    // 2. Capture pre-click state for change detection
    const preClickUrl = page.url();
    const preClickCookies = await this._getIdentityCookies(page);

    // Early check: if we are already using the target Page identity, we can skip switching
    if (isMatchingIdentity(preClickCookies)) {
      onStatus(t('backend.status.already_fanpage') + ' (Early Cookie Check)', 'success');
      return true;
    }

    // 3. Click main "Switch" button
    onStatus(t('backend.status.searching_switch_btn'));
    const mainBtnHandle = await this._findButtonHandle(page, ['chuyển', 'switch', 'chuyển ngay', 'switch now']);

    if (mainBtnHandle) {
      onStatus(t('backend.status.switch_btn_found'));
      await this._robustClick(page, mainBtnHandle);
      await mainBtnHandle.dispose();

      onStatus(t('backend.status.waiting_identity_change'));

      // 4. Poll for BOTH: confirmation modal OR navigation/cookie change
      let switched = false;
      const startTime = Date.now();

      while (Date.now() - startTime < 10000) {
        // Check A: Did URL or cookies change? (immediate switch, no modal)
        const hasChanged = await this._hasIdentityChanged(page, preClickUrl, preClickCookies);
        if (hasChanged) {
           onStatus(t('backend.status.identity_changed_immediate'), 'success');
          await delay(2000);
          switched = true;
          break;
        }

        // Check B: Did a confirmation modal appear?
        const confirmBtnHandle = await this._findButtonHandle(page, ['chuyển', 'switch', 'xác nhận'], true);
        if (confirmBtnHandle) {
           onStatus(t('backend.status.modal_detected'), 'info');
          await this._robustClick(page, confirmBtnHandle);
          await confirmBtnHandle.dispose();

           onStatus(t('backend.status.waiting_fb_switch'));
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await delay(2000);
          switched = true;
          break;
        }

        await delay(1500);
      }

      if (switched) {
        onStatus(t('backend.status.identity_switch_success'), 'success');
        return true;
      }

      onStatus(t('backend.status.no_modal_detected'), 'info');
    }

    // 5. Fallback: check if already using Page identity
    onStatus(t('backend.status.checking_actual_identity'));
    const isAlreadyPage = await page.evaluate(() => {
      // 1. Check for composer elements
      const composer = document.querySelector('div[aria-label="Tạo bài viết"], div[aria-label="Create post"]');
      // 2. Check for manage/professional dashboard links
      const manageLink = document.querySelector('a[href*="/meta_business_suite"], a[href*="/professional_dashboard"]');
      // 3. Check for specific page identity icons/buttons (like manage page)
      const manageBtn = Array.from(document.querySelectorAll('div[role="button"], span[dir="auto"]')).find(el => {
        const text = (el.innerText || '').toLowerCase();
        return text.includes('quản lý') || text.includes('manage') || text.includes('xem công cụ') || text.includes('view tools');
      });
      // 4. If we are on a group page (sometimes it redirects), check if acting as page is allowed.
      return !!composer || !!manageLink || !!manageBtn;
    });

    if (isAlreadyPage) {
      onStatus(t('backend.status.already_fanpage'), 'success');
      return true;
    }

    // 6. Check identity cookies directly
    const currentCookies = await this._getIdentityCookies(page);
    if (isMatchingIdentity(currentCookies)) {
      onStatus(t('backend.status.already_fanpage') + ' (Cookie check)', 'success');
      return true;
    }

    throw new Error(t('backend.errors.cannot_switch'));
  }

  _isAtTargetPage(currentUrl, targetUrl, targetPageId = null) {
    const cur = (currentUrl || '').toLowerCase();
    if (!cur.includes('facebook.com') || cur.includes('business.facebook.com')) return false;
    if (targetPageId) {
      return cur.includes(targetPageId.toLowerCase());
    }
    const cleanTarget = (targetUrl || '')
      .replace(/^https?:\/\/(www\.)?facebook\.com\/?/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    if (!cleanTarget) return true;
    return cur.includes(cleanTarget);
  }

  /**
   * Locate button ElementHandle based on text.
   * Prioritize visible buttons with real dimensions.
   */
  async _findButtonHandle(page, texts, mustInModal = false) {
    return await page.evaluateHandle((targetTexts, inModal) => {
      const all = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], button, div[role="radio"], div[role="listitem"]'));
      
      return all.find(btn => {
        const text = (btn.innerText || '').trim().toLowerCase();
        
        // Kiểm tra text matching
        const match = targetTexts.some(t => text === t || (t.length > 5 && text.includes(t)));
        if (!match) return false;

        // Kiểm tra hiển thị
        const rect = btn.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) return false;

        // Nếu yêu cầu nằm trong modal
        if (inModal) {
          const dialog = btn.closest('div[role="dialog"]') || btn.closest('div[role="main"] + div');
          if (!dialog) return false;
        }

        return true;
      });
    }, texts, mustInModal).then(handle => handle.asElement());
  }

  /**
   * Robust click using Puppeteer mouse coordinates (simulating real user)
   */
  async _robustClick(page, elementHandle) {
    if (!elementHandle) return;
    
    // Cuộn tới phần tử
    await elementHandle.scrollIntoView().catch(() => {});
    await delay(500);

    // Lấy toạ độ tâm
    const box = await elementHandle.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await delay(200);
      await page.mouse.down();
      await delay(100);
      await page.mouse.up();
      await delay(1000);
    } else {
      // Fallback nếu không lấy được box
      await elementHandle.click({ delay: 100 });
    }
  }

  /**
   * Snapshot identity-related cookies for change detection.
   * @returns {Promise<{iUser: string, cUser: string}>}
   */
  async _getIdentityCookies(page) {
    const cookies = await page.cookies('https://www.facebook.com');
    const find = (name) => cookies.find((c) => c.name === name)?.value || '';
    return {
      iUser: find('i_user'),
      cUser: find('c_user'),
    };
  }

  /**
   * Check if identity changed by comparing URL and cookies against pre-click state.
   */
  async _hasIdentityChanged(page, preClickUrl, preClickCookies) {
    // URL changed (navigation/reload happened)
    const currentUrl = page.url();
    if (currentUrl !== preClickUrl) return true;

    // Identity cookies changed
    const currentCookies = await this._getIdentityCookies(page);
    if (currentCookies.iUser !== preClickCookies.iUser) return true;
    if (currentCookies.cUser !== preClickCookies.cUser) return true;

    return false;
  }
}

module.exports = new PageSwitcher();
