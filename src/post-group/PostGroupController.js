const { t } = require('../utils/i18n');
const path = require('path');
const { facebook: defaultConfig } = require('../config');
const { launchStealthBrowser } = require('../browser/BrowserLauncher');
const { PageSwitcher } = require('../page-handler');
const { waitForPageSettled } = require('./utils/dom');
const { openComposer } = require('./actions/ComposerLocator');
const { fillComposer } = require('./actions/ComposerTyper');
const { resolveImageFileInput } = require('./actions/MediaUploader');
const { delay } = require('./utils/helpers');
const { saveDebugScreenshot } = require('./utils/debug');

class PostGroupController {
  constructor(config = defaultConfig) {
    this.config = config;
    this.browser = null;
    this.targetPage = null;
  }

  async initBrowser(sessionDir) {
    this.browser = await launchStealthBrowser({
      headless: false,
      defaultViewport: null,
    });

    const pages = await this.browser.pages();
    this.targetPage = pages[0] || (await this.browser.newPage());

    await this.targetPage.bringToFront();
    await this.targetPage.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    await this.targetPage.setDefaultTimeout(this.config.actionTimeoutMs);
  }

  async injectCookies(page, cookieString) {
    let cookies = [];
    try {
      const parsed = JSON.parse(cookieString);
      let cookieArray = Array.isArray(parsed) ? parsed : (parsed.cookies || []);
      if (cookieArray.length > 0) {
        cookies = cookieArray.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.facebook.com',
          path: c.path || '/',
        }));
      }
    } catch (e) {
      const cookiePairs = cookieString.split(';').map(pair => pair.trim()).filter(Boolean);
      cookies = cookiePairs.map(pair => {
        const splitIdx = pair.indexOf('=');
        if (splitIdx === -1) return null;
        const name = pair.slice(0, splitIdx);
        const value = pair.slice(splitIdx + 1);
        return {
          name: name.trim(),
          value: value.trim(),
          domain: '.facebook.com',
          path: '/',
        };
      }).filter(c => c && c.name);
    }
    
    if (cookies.length > 0) {
      await page.setCookie(...cookies);
    }
  }

  async navigateToGroup(groupUrl, onStatus) {
    onStatus(t('backend.status.opening_group_page'));
    await this.targetPage.goto(groupUrl, {
      waitUntil: 'domcontentloaded',
      timeout: this.config.navigationTimeoutMs,
    });

    await waitForPageSettled(this.targetPage);
    await this.dismissLoginModal(this.targetPage, onStatus);

    if (this.targetPage.url().includes('/login')) {
      throw new Error(t('backend.errors.facebook_login_2'));
    }
  }

  async dismissLoginModal(page, onStatus) {
    try {
      const btnHandle = await page.evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('div[role="button"]'));
        for (const btn of btns) {
            const text = (btn.innerText || '').trim().toLowerCase();
            if (text.includes('continue as ') || text.includes('tiếp tục d')) {
                return btn;
            }
        }
        
        const dialog = document.querySelector('div[role="dialog"]');
        if (dialog) {
          const closeBtn = dialog.querySelector('div[aria-label="Close"], div[aria-label="Đóng"]');
          if (closeBtn && closeBtn.getAttribute('role') === 'button') return closeBtn;
        }
        return null;
      });

      const btn = btnHandle.asElement();
      if (btn) {
        onStatus(t('backend.status.popup_detected'));
        await btn.click({ delay: 50 });
        await new Promise(r => setTimeout(r, 6000));
      }
    } catch (e) {
      // Ignore
    }
  }



  async prepareDraft({ content, imagePath, cookieString, groupUrl, sessionDir, pageIdentity, onStatus = () => {} }) {
    try {
      await this.initBrowser(sessionDir);

      if (cookieString) {
        onStatus(t('backend.status.setting_cookies_profile'));
        await this.injectCookies(this.targetPage, cookieString);
      }

      // 1. Switch identity if Fanpage is specified (Perform BEFORE entering Group)
      if (pageIdentity && pageIdentity !== 'personal') {
        await PageSwitcher.switchIdentity(this.targetPage, pageIdentity, onStatus);
      }

      await this.navigateToGroup(groupUrl, onStatus);

      onStatus(t('backend.status.waiting_composer_area'));
      const composer = await openComposer(this.targetPage, this.config.actionTimeoutMs, onStatus);

      onStatus(t('backend.status.entering_post_content'));
      await fillComposer(this.targetPage, composer, content);

      if (imagePath) {
        const fileInput = await resolveImageFileInput(
          this.targetPage,
          this.config.actionTimeoutMs,
          onStatus,
          imagePath
        );

        // If fileInput exists, it means we fallback to DOM input element instead of using the native FileChooser
        if (fileInput) {
          await fileInput.uploadFile(path.resolve(imagePath));
        }
        await delay(4000);
      }

      onStatus(t('backend.status.content_filled_review'), 'success');

      return {
        browser: this.browser,
        page: this.targetPage,
      };
    } catch (error) {
      if (this.targetPage) {
        const screenshotPath = await saveDebugScreenshot(this.targetPage, sessionDir);
        if (screenshotPath) {
          onStatus(t('backend.status.error_screenshot_saved', {path: screenshotPath}), 'error');
        }
      }

      await this.close();
      throw error;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.targetPage = null;
    }
  }
}

module.exports = PostGroupController;
