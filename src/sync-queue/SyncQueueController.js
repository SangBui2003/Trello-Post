const { t } = require('../utils/i18n');
const { facebook: defaultConfig } = require('../config');
const { launchStealthBrowser } = require('../browser/BrowserLauncher');
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

    await this._closeBrowser();
    await this._updateDBState({ status: 'idle' });
  }

  // --- Private ---

  async _initBrowser() {
    this.onStatus(`[${this.queue.name}] ${t('backend.status.initializing_sync_browser')}`, 'running');
    this.browser = await launchStealthBrowser({
      headless: false,
      defaultViewport: null,
    });

    const pages = await this.browser.pages();
    this.sessionPage = pages[0] || (await this.browser.newPage());
    await this.sessionPage.bringToFront();
    await this.sessionPage.setDefaultNavigationTimeout(60000);
    await this.sessionPage.setDefaultTimeout(30000);
  }

  async _prepareSession() {
    const { cookieString } = this.profile;
    if (cookieString) {
      this.onStatus(`[${this.queue.name}] ${t('backend.status.setting_cookies')}`, 'running');
      await this._injectCookies(this.sessionPage, cookieString);
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
      });

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
      this.roundTimer = setTimeout(() => {
        this.roundTimer = null;
        resolve();
      }, ms);
    });
  }

  async _injectCookies(page, cookieString) {
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
        }));
      }
    } catch {
      const cookiePairs = cookieString.split(';').map((pair) => pair.trim()).filter(Boolean);
      cookies = cookiePairs
        .map((pair) => {
          const splitIndex = pair.indexOf('=');
          if (splitIndex === -1) return null;

          return {
            name: pair.slice(0, splitIndex).trim(),
            value: pair.slice(splitIndex + 1).trim(),
            domain: '.facebook.com',
            path: '/',
          };
        })
        .filter((cookie) => cookie && cookie.name);
    }

    if (cookies.length > 0) {
      await page.setCookie(...cookies);
    }
  }

  async _closeBrowser() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.sessionPage = null;
    }
  }
}

module.exports = SyncQueueController;
