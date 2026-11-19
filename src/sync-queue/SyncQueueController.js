const { t } = require('../utils/i18n');
const { facebook: defaultConfig } = require('../config');
const { injectCookies } = require('../cookie-extractor');
const { PageSwitcher, joinGroup } = require('../page-handler');
const { delay } = require('../post-group/utils/helpers');

class SyncQueueController {
  constructor({
    queueId,
    queue,
    profile,
    groups,
    db,
    onStatus = () => {},
    onQueueUpdate = () => {},
    config = defaultConfig,
  }) {
    this.queueId = queueId;
    this.queue = queue;
    this.profile = profile;
    this.groups = groups;
    this.db = db;
    this.onStatus = onStatus;
    this.onQueueUpdate = onQueueUpdate;
    this.config = config;

    this.browser = null;
    this.sessionPage = null;
    this.running = false;
    this.roundTimer = null;
    
    const savedState = this.queue.state || {};
    this.state = {
      currentGroupIndex: typeof savedState.currentGroupIndex === 'number' ? savedState.currentGroupIndex : 0,
    };
  }

  async start() {
    this.running = true;

    await this._initBrowser();
    await this._prepareSession();

    this._runLoop().catch(error => {
      this.onStatus(`[${this.queue.name}] ${t('backend.status.loop_error', {message: error.message})}`, 'error');
      this._logToDB(t('backend.status.system_loop_error', {message: error.message}), 'error');
    });

    return {
      browser: this.browser,
      queueId: this.queueId,
    };
  }

  async stop() {
    this.running = false;

    if (this.roundTimer) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
    if (this.timerResolver) {
      this.timerResolver();
      this.timerResolver = null;
    }

    if (this.sessionPage && !this.sessionPage.isClosed()) {
      try {
        const cookies = await this.sessionPage.cookies();
        if (cookies && cookies.length > 0 && this.db && this.queue.profileId) {
          const cookieString = JSON.stringify({ cookies });
          await this.db.updateCookieString(this.queue.profileId, cookieString);
        }
      } catch (e) {
        // Ignore
      }
    }

    // KHÔNG đóng browser khi dừng hàng đợi (giữ nguyên trình duyệt)
    await this._updateDBState({ status: 'idle' });
  }

  // --- Private ---

  async _initBrowser() {
    this.onStatus(`[${this.queue.name}] ${t('backend.status.initializing_sync_browser')}`, 'running');
    
    const key = String(this.queue.profileId);
    const { runningBrowsers, launchingPromises, focusBrowserWindow, notifyRunningProfiles } = require('../ipc/profile');
    const { launchStealthBrowser, setWindowTitle, getProfileUserDataDir } = require('../browser/BrowserLauncher');

    if (launchingPromises && launchingPromises.has(key)) {
      await launchingPromises.get(key).catch(() => {});
    }

    const existingEntry = runningBrowsers ? runningBrowsers.get(key) : null;
    if (existingEntry && existingEntry.initPromise) {
      await existingEntry.initPromise.catch(() => {});
    }

    if (existingEntry && existingEntry.browser && existingEntry.browser.isConnected()) {
      this.browser = existingEntry.browser;
      const pages = await this.browser.pages();
      let candidate = (existingEntry.targetPage && !existingEntry.targetPage.isClosed())
        ? existingEntry.targetPage
        : null;

      if (candidate) {
        try {
          const u = (candidate.url() || '').toLowerCase();
          if (u.startsWith('file://')) candidate = null;
          else await candidate.evaluate(() => true);
        } catch {
          candidate = null;
        }
      }

      if (!candidate) {
        candidate = pages.find(p => {
          try {
            const u = (p.url() || '').toLowerCase();
            return u.includes('facebook.com') && !u.includes('business.facebook.com') && !p.isClosed();
          } catch { return false; }
        }) || pages.find(p => {
          try {
            const u = (p.url() || '').toLowerCase();
            return !u.startsWith('file://') && !p.isClosed();
          } catch { return false; }
        }) || (await this.browser.newPage());
      }

      this.sessionPage = candidate;
      existingEntry.targetPage = this.sessionPage;
      await setWindowTitle(this.sessionPage, this.queue.name);
      await focusBrowserWindow(this.browser, this.sessionPage);
    } else {
      const userDataDir = getProfileUserDataDir(this.queue.profileId);
      this.browser = await launchStealthBrowser({
        headless: false,
        defaultViewport: null,
        userDataDir,
      });

      const pages = await this.browser.pages();
      this.sessionPage = pages[0] || (await this.browser.newPage());

      await setWindowTitle(this.sessionPage, this.queue.name);
      this.browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
          const newPage = await target.page().catch(() => null);
          if (newPage) await setWindowTitle(newPage, this.queue.name);
        }
      });

      if (runningBrowsers) {
        runningBrowsers.set(key, {
          browser: this.browser,
          targetPage: this.sessionPage,
          infoPage: null,
          initPromise: null,
        });
        notifyRunningProfiles();
      }

      this.browser.once('disconnected', () => {
        if (runningBrowsers && runningBrowsers.get(key)?.browser === this.browser) {
          runningBrowsers.delete(key);
          notifyRunningProfiles();
        }
      });
    }

    await this.sessionPage.bringToFront();
    await this.sessionPage.setDefaultNavigationTimeout(60000);
    await this.sessionPage.setDefaultTimeout(30000);
  }

  async _prepareSession() {
    const { cookieString } = this.profile;
    const existingCookies = await this.sessionPage.cookies('https://www.facebook.com').catch(() => []);
    const hasValidSessionCookies = existingCookies.some(c => c.name === 'c_user' && c.value) &&
                                   existingCookies.some(c => c.name === 'xs' && c.value);

    if (!hasValidSessionCookies && cookieString) {
      this.onStatus(`[${this.queue.name}] ${t('backend.status.setting_cookies')}`, 'running');
      await this._injectCookies(this.sessionPage, cookieString);
    }
    
    const currentUrl = (this.sessionPage.url() || '').toLowerCase();
    const isOnValidFacebook = currentUrl.includes('www.facebook.com') &&
                              !currentUrl.includes('business.facebook.com') &&
                              currentUrl !== 'about:blank';

    if (!isOnValidFacebook) {
      await this.sessionPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
    } else {
      await new Promise(r => setTimeout(r, 1000));
    }

    const { checkFacebookLoginState, autoLoginFacebook } = require('../login-handler/FacebookLogin');
    let loginCheck = await checkFacebookLoginState(this.sessionPage, this.profile.metadata?.uid);

    if (!loginCheck.isLoggedIn && hasValidSessionCookies && cookieString) {
      await this._injectCookies(this.sessionPage, cookieString);
      await this.sessionPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
      loginCheck = await checkFacebookLoginState(this.sessionPage, this.profile.metadata?.uid);
    }
    
    if (!loginCheck.isLoggedIn) {
        const loginSuccess = await autoLoginFacebook(this.sessionPage, this.profile.metadata, (msg, type) => this.onStatus(`[${this.queue.name}] ${msg}`, type || 'info'));
        if (!loginSuccess) {
           throw new Error(t('backend.errors.facebook_login'));
        }
        
        // Re-navigate to facebook.com to ensure state is clean before PageSwitcher
        await this.sessionPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
    } else {
        this.onStatus(`[${this.queue.name}] Tài khoản đã đăng nhập sẵn. Giữ nguyên phiên làm việc.`, 'info');
    }

    const { pageIdentity } = this.queue;
    if (pageIdentity && pageIdentity !== 'personal') {
      await PageSwitcher.switchIdentity(this.sessionPage, pageIdentity, (msg, level) => {
        this.onStatus(`[${this.queue.name}] ${msg}`, level);
      });
    } else {
      this.onStatus(`[${this.queue.name}] ${t('backend.status.using_personal_account')}`, 'info');
    }
  }

  async _runLoop() {
    while (this.running) {
      try {
        const result = await this._executeStep();
        if (result === 'completed') {
          this.onStatus(`[${this.queue.name}] ${t('backend.status.all_groups_joined_success')}`, 'success');
          await this._logToDB(t('backend.status.completed_all_groups'), 'success');
          if (this.db.flush) await this.db.flush();
          await this.stop();
          break;
        } else if (result === 'stopped') {
          break; // Stop was called
        }
      } catch (error) {
        this.onStatus(`[${this.queue.name}] Error: ${error.message}`, 'error');
      }

      if (!this.running) break;

      const delayMinutes = this.queue.delayMinutes || 1;
      this.onStatus(`[${this.queue.name}] ${t('backend.status.pausing_minutes_before', {minutes: delayMinutes})}`, 'info');
      await this._updateDBState({ status: 'waiting' });
      
      // Random wait +- 20% to look human
      const baseWaitMs = delayMinutes * 60 * 1000;
      const vary = baseWaitMs * 0.2;
      const finalWaitMs = baseWaitMs + (Math.random() * vary * 2 - vary);
      
      await this._waitInterval(Math.floor(finalWaitMs));
    }
  }

  async _executeStep() {
    if (!this.groups || this.groups.length === 0) throw new Error(t('backend.errors.no_groups'));

    const gIndex = this.state.currentGroupIndex;
    if (gIndex >= this.groups.length) {
      return 'completed';
    }

    const group = this.groups[gIndex];
    if (!group.url) {
      this._incrementState();
      return 'next';
    }

    const stepLabel = `Group ${gIndex + 1}/${this.groups.length}`;
    const prefix = `[${this.queue.name}] [${stepLabel}]`;

    this.onStatus(`${prefix}: ${t('backend.status.starting_processing_task')}`, 'running');
    await this._updateDBState({ status: 'running' });

    try {
      const status = await joinGroup(this.sessionPage, group.url, (msg, type) => {
        this.onStatus(`${prefix}: ${msg}`, type);
      }, this.profile.metadata);

      const translatedStatus = t(`backend.status.status_${status.toLowerCase()}`);
      this.onStatus(`${prefix}: ${t('backend.status.processed_group_result', {name: group.name, status: translatedStatus})}`, 'success');
      await this._logToDB(t('backend.status.processed_group_result', {name: group.name, status: translatedStatus}), 'success');

      if (gIndex === this.groups.length - 1) {
        this.state.currentGroupIndex = this.groups.length; 
        await this._updateDBState({ currentGroupIndex: this.state.currentGroupIndex });
        return 'completed';
      }

      this._incrementState();
      await this._updateDBState({ currentGroupIndex: this.state.currentGroupIndex });
      return 'next';

    } catch (error) {
      this.onStatus(`${prefix}: ${t('backend.status.error_at_group_log', {name: group.name, message: error.message})}`, 'error');
      await this._logToDB(t('backend.status.error_at_group_log', {name: group.name, message: error.message}), 'error');
      
      this._incrementState();
      await this._updateDBState({ currentGroupIndex: this.state.currentGroupIndex });
      return 'next';
    }
  }

  _incrementState() {
    this.state.currentGroupIndex += 1;
  }

  async _updateDBState(newState) {
    if (this.db && this.queueId) {
      await this.db.updateSyncQueueState(this.queueId, newState);
      await this._pushQueueUpdate();
    }
  }

  async _logToDB(message, type = 'info') {
    if (this.db && this.queueId) {
      await this.db.addSyncQueueLog(this.queueId, { message, type });
      await this._pushQueueUpdate();
    }
  }

  async _pushQueueUpdate() {
    try {
      const freshQueue = await this.db.getSyncQueueById(this.queueId);
      if (freshQueue) {
        this.onQueueUpdate(this.queueId, freshQueue);
      }
    } catch {
      // Non-critical
    }
  }

  _waitInterval(ms) {
    return new Promise((resolve) => {
      this.timerResolver = resolve;
      this.roundTimer = setTimeout(() => {
        this.roundTimer = null;
        this.timerResolver = null;
        resolve();
      }, ms);
    });
  }

  async _injectCookies(page, cookieString) {
    await injectCookies(page, cookieString);
  }
}

module.exports = SyncQueueController;
