const { t } = require('../utils/i18n');
const path = require('path');
const fs = require('fs');
const { facebook: defaultConfig } = require('../config');
const { injectCookies } = require('../cookie-extractor');
const { PageSwitcher } = require('../page-handler');
const { waitForPageSettled } = require('../post-group/utils/dom');
const { openComposer } = require('../post-group/actions/ComposerLocator');
const { delay } = require('../post-group/utils/helpers');
const { saveDebugScreenshot } = require('../post-group/utils/debug');

// Đảm bảo mỗi profileId chỉ có tối đa 1 controller điều khiển tại 1 thời điểm
const activeProfileControllers = new Map();

class PostQueueController {
  constructor({
    queueId,
    queue,
    profile,
    sessionDir,
    db,
    onStatus = () => { },
    onNotify = () => { },
    onQueueUpdate = () => { },
    onComplete = () => { },
    config = defaultConfig,
  }) {
    this.queueId = queueId;
    this.queue = queue;
    this.profile = profile;
    this.sessionDir = sessionDir;
    this.db = db;
    this.onStatus = onStatus;
    this.onNotify = onNotify;
    this.onQueueUpdate = onQueueUpdate;
    this.onComplete = onComplete;
    this.config = config;

    this.browser = null;
    this.sessionPage = null;
    this.running = false;
    this.roundTimer = null;
    this.navigatedToTargetWall = false;
    this._loopPromise = null;

    // Manual approval promise
    this.approvalResolver = null;
    this.approvalPage = null;

    // Initialize state from queue data
    const savedState = this.queue.state || {};
    let initialIndex = typeof savedState.currentPostIndex === 'number' ? savedState.currentPostIndex : 0;
    const posts = Array.isArray(this.queue.posts) ? this.queue.posts : [];
    const hasRemainingSelected = posts.slice(initialIndex).some((p) => p.selected !== false);
    if (!hasRemainingSelected) {
      initialIndex = 0;
    }
    this.state = {
      currentPostIndex: initialIndex,
    };
  }

  _assertRunning() {
    if (!this.running) {
      const err = new Error('QUEUE_STOPPED');
      err.isStopped = true;
      throw err;
    }
  }

  async _enableBackgroundExecution(page) {
    if (!page || page.isClosed()) return;
    try {
      const session = await page.target().createCDPSession();
      await session.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
      await session.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
      await session.detach().catch(() => {});
    } catch {
      // Ignore if target closed
    }
  }

  async start() {
    if (this.running) {
      return {
        browser: this.browser,
        queueId: this.queueId,
      };
    }
    this.running = true;

    const profileKey = String(this.queue.profileId);
    const prevController = activeProfileControllers.get(profileKey);
    if (prevController && prevController !== this && prevController.running) {
      await prevController.stop().catch(() => {});
    }
    activeProfileControllers.set(profileKey, this);

    try {
      await this._initBrowser();
      this._assertRunning();
      await this._prepareSession();
      this._assertRunning();
    } catch (error) {
      this.running = false;
      if (activeProfileControllers.get(profileKey) === this) {
        activeProfileControllers.delete(profileKey);
      }
      if (error?.isStopped) {
        this.onComplete();
        return { browser: this.browser, queueId: this.queueId };
      }
      throw error;
    }

    this._loopPromise = this._runLoop()
      .catch((error) => {
        if (error?.isStopped) return;
        this.onStatus(`[${this.queue.name}] ${t('backend.status.loop_error', { message: error.message })}`, 'error');
        this._logToDB(t('backend.status.system_loop_error', { message: error.message }), 'error');
      })
      .finally(() => {
        this.running = false;
        if (activeProfileControllers.get(profileKey) === this) {
          activeProfileControllers.delete(profileKey);
        }
        this.onComplete();
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

    // Resolve any pending approval to allow the loop to finish properly
    if (this.approvalResolver) {
      this.approvalResolver(false);
      this.approvalResolver = null;
    }
    this.approvalPage = null;

    if (this._loopPromise) {
      await Promise.race([this._loopPromise.catch(() => {}), delay(3000)]);
    }

    const profileKey = String(this.queue.profileId);
    if (activeProfileControllers.get(profileKey) === this) {
      activeProfileControllers.delete(profileKey);
    }

    // Trích xuất cookie để lưu lại trạng thái phiên trước khi dừng
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

    // KHÔNG đóng browser khi dừng hàng đợi (giữ nguyên trình duyệt để người dùng tiếp tục thao tác)
    // Tự động đặt lại trạng thái về idle
    this.state.currentPostIndex = 0;
    await this._updateDBState({ currentPostIndex: 0, status: 'idle' });
  }

  /**
   * Continue signal from UI (manual approval mode)
   */
  async approve() {
    if (this.approvalResolver) {
      this.approvalResolver(true);
      this.approvalResolver = null;
    }
  }

  async focus() {
    if (this.approvalPage) {
      try {
        await this.approvalPage.bringToFront();

        // Windows-specific hack to bring window to front
        if (process.platform === 'win32' && this.browser) {
          const { exec } = require('child_process');
          const pid = this.browser.process()?.pid;
          if (pid) {
            // Use AppActivate via PowerShell to force focus window by PID
            exec(`powershell -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.AppActivate(${pid})"`);
          }
        }
      } catch (e) {
        console.error('Failed to focus tab:', e);
      }
    }
  }

  // --- Private ---

  async _initBrowser() {
    this.onStatus(`[${this.queue.name}] ${t('backend.status.initializing_browser')}`, 'running');
    
    const key = String(this.queue.profileId);
    const { runningBrowsers, launchingPromises, notifyRunningProfiles } = require('../ipc/profile');
    const { launchStealthBrowser, setWindowTitle, getProfileUserDataDir } = require('../browser/BrowserLauncher');

    // Nếu người dùng vừa bấm mở trình duyệt từ thẻ Profile và đang trong quá trình khởi tạo, đợi hoàn tất để tránh xung đột điều hướng
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
          if (u.startsWith('file://')) {
            candidate = null;
          } else {
            await candidate.evaluate(() => true);
          }
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

    await this.sessionPage.bringToFront().catch(() => {});
    await this._enableBackgroundExecution(this.sessionPage);
    await this.sessionPage.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    await this.sessionPage.setDefaultTimeout(this.config.actionTimeoutMs);
  }

  /**
   * Kiểm tra xem URL hiện tại có đang ở Trang chủ / Bảng tin Facebook (không phải tường cá nhân / Fanpage) không
   */
  _isOnFacebookHomeFeed(currentUrl) {
    try {
      const u = new URL(currentUrl);
      const pathName = (u.pathname || '/').replace(/\/+$/, '') || '/';
      const hasProfileId = u.searchParams.has('id');
      return (pathName === '/' && !hasProfileId) || pathName === '/home.php' || pathName === '/feeds';
    } catch {
      return false;
    }
  }

  /**
   * Kiểm tra xem URL hiện tại có đang đứng ở các tab phụ (Reels, Ảnh, Giới thiệu, Video, Đề xuất,...) thay vì tab Tất cả / Bài viết hay không.
   */
  _isOnProfileSubTab(currentUrl) {
    try {
      const u = new URL(currentUrl);
      const sk = (u.searchParams.get('sk') || '').toLowerCase().trim();
      if (sk && !['wall', 'timeline', 'posts'].includes(sk)) {
        return true;
      }
      const pathName = (u.pathname || '').replace(/\/+$/, '').toLowerCase();
      const subTabRegex = /\/(reels|reels_tab|photos|photos_by|photos_albums|photos_of|about|about_[a-z0-9_]+|videos|live_videos|mentions|reviews|reviews_given|followers|following|friends|friends_[a-z0-9_]+|events|groups|community|shop|services|offers|jobs|music|sports|movies|tv|books|likes|map|checkins)(\/|$)/i;
      return subTabRegex.test(pathName);
    } catch {
      return false;
    }
  }

  _cleanTargetWallUrl(rawUrl) {
    if (!rawUrl || rawUrl === 'personal') return rawUrl;
    try {
      const u = new URL(rawUrl);
      if (u.searchParams.has('sk')) {
        u.searchParams.delete('sk');
      }
      u.pathname = u.pathname.replace(
        /\/(reels|reels_tab|photos|photos_by|photos_albums|photos_of|about|about_[a-z0-9_]+|videos|live_videos|mentions|reviews|reviews_given|followers|following|friends|friends_[a-z0-9_]+|events|groups|community|shop|services|offers|jobs|music|sports|movies|tv|books|likes|map|checkins)(\/.*)?$/i,
        ''
      );
      return u.toString();
    } catch {
      return rawUrl;
    }
  }

  /**
   * Tự động xác định URL tường đích (Fanpage hoặc Trang cá nhân) để tuyệt đối không bao giờ đăng ở Trang chủ FB chính.
   */
  _resolveEffectiveTarget() {
    const rawIdentity = (this.queue.pageIdentity || '').trim();
    if (rawIdentity && rawIdentity !== 'personal') {
      const cleaned = this._cleanTargetWallUrl(rawIdentity);
      return { pageIdentity: cleaned, targetUrl: cleaned, isFanpage: true };
    }

    // Nếu hàng đợi để 'personal' nhưng Profile thực chất có Fanpage duy nhất -> tự động lấy Fanpage đó
    const badSlugs = ['/reg', '/lite', '/about', '/pages/create', '/careers'];
    const validPages = (this.profile?.pages || []).filter((p) => {
      const u = (p?.pageUrl || '').toLowerCase();
      return u.includes('facebook.com/') && !badSlugs.some((slug) => u.includes(slug));
    });

    if (validPages.length === 1) {
      const cleaned = this._cleanTargetWallUrl(validPages[0].pageUrl);
      return {
        pageIdentity: cleaned,
        targetUrl: cleaned,
        isFanpage: true,
      };
    }

    // Kiểm tra i_user / c_user trong cookie của Profile
    const { parseCookieString } = require('../cookie-extractor');
    const cookies = parseCookieString(this.profile?.cookieString || '');
    const iUser = cookies.find((c) => c.name === 'i_user' && c.value)?.value;
    if (iUser) {
      const matchedPage = validPages.find((p) => (p.pageUrl || '').includes(iUser));
      const fanpageUrl = this._cleanTargetWallUrl(
        matchedPage ? matchedPage.pageUrl : `https://www.facebook.com/profile.php?id=${iUser}`
      );
      return {
        pageIdentity: fanpageUrl,
        targetUrl: fanpageUrl,
        isFanpage: true,
      };
    }

    const cUser = cookies.find((c) => c.name === 'c_user' && c.value)?.value || this.profile?.metadata?.uid;
    const personalWallUrl = cUser
      ? `https://www.facebook.com/profile.php?id=${cUser}`
      : 'https://www.facebook.com/me';

    return {
      pageIdentity: 'personal',
      targetUrl: personalWallUrl,
      isFanpage: false,
    };
  }

  _isSameProfileOrPage(currentUrl, targetUrl) {
    const cur = (currentUrl || '').toLowerCase();
    if (!cur.includes('www.facebook.com') || cur.includes('business.facebook.com') || cur.includes('/post/create')) {
      return false;
    }
    if (this._isOnFacebookHomeFeed(currentUrl)) {
      return false;
    }
    if (!targetUrl || targetUrl === 'personal' || targetUrl === 'https://www.facebook.com/me') {
      return true;
    }
    const targetIdMatch = (targetUrl || '').match(/[?&]id=(\d+)|facebook\.com\/(\d{10,})/i);
    const targetPageId = targetIdMatch ? (targetIdMatch[1] || targetIdMatch[2]) : null;
    if (targetPageId && cur.includes(targetPageId.toLowerCase())) {
      return true;
    }
    const cleanTarget = (this._cleanTargetWallUrl(targetUrl) || '')
      .replace(/^https?:\/\/(www\.)?facebook\.com\/?/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    if (cleanTarget && cur.includes(cleanTarget)) {
      return true;
    }
    return false;
  }

  _isAtTargetWall(currentUrl, targetUrl) {
    if (!this._isSameProfileOrPage(currentUrl, targetUrl)) {
      return false;
    }
    // Nếu đang đứng ở mục phụ (Reels, Ảnh, Giới thiệu, Video,...) thì CHƯA ở tường chính để đăng bài
    if (this._isOnProfileSubTab(currentUrl)) {
      return false;
    }
    return true;
  }

  /**
   * Đảm bảo trình duyệt trên Trang cá nhân / Fanpage đang đứng ở tab "Tất cả" / "Bài viết" (Posts / All)
   * chứ không phải ở mục Reels, Ảnh, Video, Giới thiệu...
   */
  async _ensureOnMainPostsTab(page, targetUrl, prefix) {
    try {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
      await delay(300);

      const tabResult = await page.evaluate(() => {
        const mainTabNames = ['bài viết', 'tất cả', 'posts', 'all', 'dòng thời gian', 'timeline'];
        const subTabNames = [
          'reels', 'thước phim', 'ảnh', 'photos', 'giới thiệu', 'about',
          'video', 'videos', 'đề xuất', 'mentions', 'đánh giá', 'reviews',
          'người theo dõi', 'followers', 'bạn bè', 'friends', 'sự kiện', 'events',
          'nhóm', 'groups', 'cửa hàng', 'shop', 'cộng đồng', 'community', 'xem thêm', 'more'
        ];

        const tabs = Array.from(document.querySelectorAll('[role="tab"]')).filter((el) => {
          if (!(el instanceof HTMLElement)) return false;
          if (el.closest('[role="banner"]') || el.closest('[role="dialog"]')) return false;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 15 && rect.height > 15;
        });

        if (tabs.length === 0) return { status: 'no_tabs' };

        let mainTab = null;
        let activeSubTab = null;

        for (const tab of tabs) {
          const text = (tab.innerText || tab.textContent || '').trim().toLowerCase();
          const isSelected = tab.getAttribute('aria-selected') === 'true';

          if (!mainTab && mainTabNames.some((name) => text === name)) {
            mainTab = { el: tab, text, isSelected };
          }
          if (isSelected && subTabNames.some((name) => text === name || text.startsWith(name + ' '))) {
            activeSubTab = text;
          }
        }

        if (mainTab && (!mainTab.isSelected || activeSubTab)) {
          mainTab.el.scrollIntoView({ block: 'center', behavior: 'instant' });
          mainTab.el.click();
          return { status: 'clicked_main_tab', tabName: mainTab.text, fromSubTab: activeSubTab };
        }

        if (activeSubTab && !mainTab) {
          return { status: 'on_subtab_no_main_btn', fromSubTab: activeSubTab };
        }

        return { status: 'ok' };
      });

      if (tabResult && tabResult.status === 'clicked_main_tab') {
        this.onStatus(
          `${prefix}: Đang ở mục "${tabResult.fromSubTab || 'phụ'}", tự động chuyển về tab "${tabResult.tabName}" để đăng bài...`,
          'running'
        );
        await delay(2000);
        await waitForPageSettled(page);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
        await delay(500);
      }

      // Nếu URL vẫn còn hậu tố mục phụ (?sk=reels_tab, /reels, /photos,...) hoặc không tìm thấy nút tab chính để bấm
      if ((this._isOnProfileSubTab(page.url()) || tabResult?.status === 'on_subtab_no_main_btn') && targetUrl) {
        this.onStatus(`${prefix}: Đang điều hướng về mục Tất cả / Bài viết của trang...`, 'running');
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.navigationTimeoutMs,
        });
        await waitForPageSettled(page);
        await this._dismissLoginModal(page);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
        await delay(800);
      }
    } catch {
      // Ignore non-fatal tab check errors
    }
  }

  async _prepareSession() {
    this._assertRunning();
    const { cookieString } = this.profile;
    const { pageIdentity, targetUrl, isFanpage } = this._resolveEffectiveTarget();
    const desiredInitialUrl = targetUrl;

    // Chỉ nạp cookie từ DB nếu trình duyệt chưa có sẵn phiên c_user & xs hợp lệ (tránh ghi đè phiên sống đang chạy)
    const existingCookies = await this.sessionPage.cookies('https://www.facebook.com').catch(() => []);
    const hasValidSessionCookies = existingCookies.some(c => c.name === 'c_user' && c.value) &&
                                   existingCookies.some(c => c.name === 'xs' && c.value);

    if (!hasValidSessionCookies && cookieString) {
      this.onStatus(`[${this.queue.name}] ${t('backend.status.setting_cookies')}`, 'running');
      await this._injectCookies(this.sessionPage, cookieString);
    }

    this._assertRunning();

    // Kiểm tra trang hiện tại: nếu chưa ở trên www.facebook.com hợp lệ thì điều hướng thẳng tới trang đích
    const currentUrl = (this.sessionPage.url() || '').toLowerCase();
    const isOnValidFacebook = currentUrl.includes('www.facebook.com') &&
                              !currentUrl.includes('business.facebook.com') &&
                              !currentUrl.includes('/post/create') &&
                              currentUrl !== 'about:blank';

    if (!isOnValidFacebook) {
      this.onStatus(`[${this.queue.name}] Đang mở Facebook...`, 'running');
      await this.sessionPage.goto(desiredInitialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
    } else {
      await new Promise(r => setTimeout(r, 1000));
    }

    this._assertRunning();

    const { checkFacebookLoginState, autoLoginFacebook } = require('../login-handler/FacebookLogin');
    let loginCheck = await checkFacebookLoginState(this.sessionPage, this.profile.metadata?.uid);

    if (!loginCheck.isLoggedIn && hasValidSessionCookies && cookieString) {
      await this._injectCookies(this.sessionPage, cookieString);
      await this.sessionPage.goto(desiredInitialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
      loginCheck = await checkFacebookLoginState(this.sessionPage, this.profile.metadata?.uid);
    }

    this._assertRunning();

    if (!loginCheck.isLoggedIn) {
      const loginSuccess = await autoLoginFacebook(this.sessionPage, this.profile.metadata, (msg, type) => this.onStatus(`[${this.queue.name}] ${msg}`, type || 'info'));
      if (!loginSuccess) {
        throw new Error(t('backend.errors.facebook_login'));
      }
    } else {
      this.onStatus(`[${this.queue.name}] Tài khoản đã đăng nhập sẵn. Giữ nguyên phiên làm việc.`, 'info');
    }

    this._assertRunning();

    if (isFanpage && pageIdentity && pageIdentity !== 'personal') {
      await PageSwitcher.switchIdentity(this.sessionPage, pageIdentity, (msg, level) => {
        this.onStatus(`[${this.queue.name}] ${msg}`, level);
      });

      this._assertRunning();

      // Nếu đã ở đúng trang Fanpage nhưng đang đứng ở mục Reels, Ảnh, Giới thiệu,... thì bấm về tab Tất cả / Bài viết trước
      if (this._isSameProfileOrPage(this.sessionPage.url(), targetUrl)) {
        await this._ensureOnMainPostsTab(this.sessionPage, targetUrl, `[${this.queue.name}]`);
      }

      // Sau khi chuyển sang danh tính Fanpage, điều hướng về tường cá nhân của Fanpage nếu vẫn chưa ở đúng tường chính
      if (!this._isAtTargetWall(this.sessionPage.url(), targetUrl)) {
        this.onStatus(`[${this.queue.name}] Đang mở trang cá nhân Fanpage...`, 'running');
        await this.sessionPage.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.navigationTimeoutMs,
        });
        await waitForPageSettled(this.sessionPage);
        await this._dismissLoginModal(this.sessionPage);
      }
      await this._ensureOnMainPostsTab(this.sessionPage, targetUrl, `[${this.queue.name}]`);
      this.navigatedToTargetWall = true;
    } else {
      this.onStatus(`[${this.queue.name}] ${t('backend.status.posting_personal')}`, 'info');
      if (this._isSameProfileOrPage(this.sessionPage.url(), targetUrl)) {
        await this._ensureOnMainPostsTab(this.sessionPage, targetUrl, `[${this.queue.name}]`);
      }
      if (!this._isAtTargetWall(this.sessionPage.url(), targetUrl)) {
        this.onStatus(`[${this.queue.name}] Đang chuyển về trang cá nhân để đăng bài...`, 'running');
        await this.sessionPage.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.navigationTimeoutMs,
        });
        await waitForPageSettled(this.sessionPage);
        await this._dismissLoginModal(this.sessionPage);
      }
      await this._ensureOnMainPostsTab(this.sessionPage, targetUrl, `[${this.queue.name}]`);
      this.navigatedToTargetWall = true;
    }

    await this._enableBackgroundExecution(this.sessionPage);
  }

  async _runLoop() {
    while (this.running) {
      try {
        const result = await this._executeStep();
        if (result === 'completed') {
          this.onStatus(`[${this.queue.name}] ${t('backend.status.finished_posting')}`, 'success');
          await this._logToDB(t('backend.status.success_posted'), 'success');
          
          // Tự động đặt lại quy trình khi hoàn thành
          this.state.currentPostIndex = 0;
          await this._updateDBState({ currentPostIndex: 0, status: 'idle' });

          if (this.db.flush) await this.db.flush();

          this.onStatus(`[${this.queue.name}] Đã đăng xong! Trình duyệt được giữ mở để bạn kiểm tra. Vui lòng bấm Dừng hoặc tắt Chrome để kết thúc.`, 'info');
          // DO NOT stop() so the browser stays open for user verification.
          this.running = false; // Stop the loop but keep browser alive
          break;
        } else if (result === 'stopped') {
          this.onStatus(`[${this.queue.name}] ${t('backend.status.queue_stopped')}`, 'info');
          await this._logToDB(t('backend.status.queue_stopped'), 'info');
          this.running = false;
          break;
        }
      } catch (error) {
        if (error?.isStopped || !this.running) break;
        this.onStatus(`[${this.queue.name}] Error: ${error.message}`, 'error');
      }

      if (!this.running) break;

      // Tìm bài đăng tiếp theo ĐƯỢC CHỌN (selected !== false)
      let nextIndex = this.state.currentPostIndex;
      while (nextIndex < this.queue.posts.length && this.queue.posts[nextIndex].selected === false) {
        nextIndex++;
      }
      this.state.currentPostIndex = nextIndex;
      
      if (nextIndex >= this.queue.posts.length) {
        continue;
      }

      const nextPost = this.queue.posts[nextIndex];
      const hasSchedule = nextPost && nextPost.enableSchedule && (
        (nextPost.scheduleType === 'delay' && ((Number(nextPost.delayHours) || 0) * 60 + (Number(nextPost.delayMinutes) || 0)) > 0) ||
        (nextPost.scheduleType !== 'delay' && nextPost.scheduledTime)
      );

      if (hasSchedule) {
        this.onStatus(`[${this.queue.name}] Chuyển sang bài đăng tiếp theo (có hẹn giờ)...`, 'info');
      } else {
        this.onStatus(`[${this.queue.name}] Đã đăng tự động. Nghỉ ngơi 15 giây trước khi qua bài tiếp theo (tránh spam)...`, 'info');
        await this._waitInterval(15000); // Tự động nghỉ 15s thay vì chờ bấm Tiếp tục
      }
    }
  }

  async _executeStep() {
    if (!this.running) return 'stopped';
    const { posts } = this.queue;

    if (!posts || posts.length === 0) return 'completed';

    // Bỏ qua các bài viết không được chọn (selected === false)
    while (this.state.currentPostIndex < posts.length && posts[this.state.currentPostIndex].selected === false) {
      this.state.currentPostIndex += 1;
    }

    const pIndex = this.state.currentPostIndex;

    if (pIndex >= posts.length) {
      return 'completed';
    }

    const post = posts[pIndex];
    const { targetUrl, isFanpage } = this._resolveEffectiveTarget();
    const targetName = isFanpage ? 'Fanpage Wall' : 'Personal Wall';

    const selectedPosts = posts.filter(p => p.selected !== false);
    const selectedIdx = posts.slice(0, pIndex + 1).filter(p => p.selected !== false).length;
    const stepLabel = `Bài ${selectedIdx}/${selectedPosts.length} (Vị trí ${pIndex + 1}/${posts.length})`;
    const prefix = `[${this.queue.name}] [${stepLabel}]`;

    if (post.enableSchedule) {
      if (post.scheduleType === 'delay') {
        const totalMinutes = (Number(post.delayHours) || 0) * 60 + (Number(post.delayMinutes) || 0);
        const delayMs = totalMinutes * 60 * 1000;
        if (delayMs > 0) {
          const hours = Math.floor(totalMinutes / 60);
          const mins = totalMinutes % 60;
          const durationStr = `${hours > 0 ? `${hours} giờ ` : ''}${mins > 0 ? `${mins} phút` : ''}`.trim() || `${totalMinutes} phút`;
          const expectedDate = new Date(Date.now() + delayMs);
          const expectedTimeStr = expectedDate.toLocaleTimeString('vi-VN', {
            hour: '2-digit', minute: '2-digit', hour12: false
          });
          const expectedDayStr = expectedDate.toLocaleDateString('vi-VN');

          this.onStatus(`${prefix}: Đang chờ sau ${durationStr} trước khi đăng (dự kiến lúc ${expectedTimeStr} ngày ${expectedDayStr})...`, 'info');
          await this._updateDBState({ status: 'waiting' });
          await this._waitInterval(delayMs);
          if (!this.running) return 'stopped';
        }
      } else if (post.scheduledTime) {
        const targetTime = new Date(post.scheduledTime).getTime();
        const now = Date.now();
        const waitMs = targetTime - now;
        if (waitMs > 0) {
          const targetStr = new Date(targetTime).toLocaleString('vi-VN', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
            hour12: false
          });
          this.onStatus(`${prefix}: Đang chờ đến giờ hẹn: ${targetStr} (đồng hồ 24h)...`, 'info');
          await this._updateDBState({ status: 'waiting' });
          await this._waitInterval(waitMs);
          if (!this.running) return 'stopped';
        }
      }
    }

    this._assertRunning();
    this.onStatus(`${prefix}: ${t('backend.status.preparing')}`, 'running');
    await this._updateDBState({ status: 'running' });

    // Tải ảnh trực tiếp từ Trello Just-In-Time nếu bài viết liên kết Trello chưa có file trên máy
    if ((post.trelloCardId || post.imageUrl) && (!post.imagePath || !fs.existsSync(post.imagePath))) {
      this.onStatus(`${prefix}: Đang tải ảnh trực tiếp từ Trello...`, 'running');
      try {
        const { downloadCardImageDirect } = require('../ipc/trello');
        const res = await downloadCardImageDirect(post.trelloCardId, post.trelloCardName || post.content.slice(0, 30), post.imageUrl);
        if (res && res.filePath) {
          post.imagePath = res.filePath;
          this.onStatus(`${prefix}: Tải ảnh Trello thành công (${path.basename(res.filePath)})`, 'info');
        }
      } catch (err) {
        this.onStatus(`${prefix}: Cảnh báo tải ảnh Trello: ${err.message}`, 'warning');
      }
    }

    try {
      this._assertRunning();
      let postPage = null;
      let attempt = 1;
      const maxAttempts = 2;
      let postError = null;

      while (attempt <= maxAttempts) {
        this._assertRunning();
        try {
          const result = await this._postToFanpage({
            targetUrl,
            post,
            prefix: attempt > 1 ? `${prefix} [Retry]` : prefix,
          });
          postPage = result.page;
          postError = null;
          break; // Thành công
        } catch (error) {
          if (error?.isStopped || !this.running) throw error;
          postError = error;
          this.onStatus(`${prefix}: Lỗi lần ${attempt} (${error.message}).`, 'warning');
          attempt++;
          if (attempt <= maxAttempts) {
            this.onStatus(`${prefix}: Đang thử lại mở khung đăng bài...`, 'info');
            await this.sessionPage.keyboard.press('Escape').catch(() => {});
            await this.sessionPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
            await delay(2000);
          }
        }
      }

      if (postError) {
        throw postError; // Ném ra ngoài nếu thất bại cả 2 lần
      }

      this._assertRunning();

      // Tự động kiểm tra và viết bình luận (nếu bài viết có yêu cầu comment hoặc có link)
      let commentText = post.commentText || '';
      if (!commentText) {
        const content = post.content || '';
        const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
        commentText = lines.find(l => l.includes('http://') || l.includes('https://'));
        
        if (!commentText) {
          const urlMatch = content.match(/(https?:\/\/[^\s\n]+)/);
          if (urlMatch) {
            const wrappedLink = urlMatch[0];
            const { getCTAConfig } = require('../ipc/trello');
            const ctaList = getCTAConfig();
            const cta = ctaList.length > 0 ? ctaList[Math.floor(Math.random() * ctaList.length)] : "";
            commentText = `${cta} ${wrappedLink}`.trim();
          }
        }
      }

      if (commentText) {
        // Tự động kiểm tra và bọc link theo cấu hình đầu web nếu link trong comment chưa thuộc đầu web mục tiêu
        try {
          const urlMatch = commentText.match(/(https?:\/\/[^\s\n]+)/);
          if (urlMatch) {
            const rawUrl = urlMatch[0];
            const { wrapLink } = require('../browser/TinfosWrapper');
            const wrapped = await wrapLink(rawUrl);
            if (wrapped && wrapped !== rawUrl) {
              commentText = commentText.replace(rawUrl, wrapped);
              post.commentText = commentText;
            }
          }
        } catch (wrapErr) {
          console.warn('[PostQueue] Bỏ qua bọc link bình luận JIT:', wrapErr.message);
        }

        await this._commentOnNewPost({
          postPage,
          post,
          commentText,
          targetUrl,
          prefix,
        });
      } else {
        this.onStatus(`${prefix}: Đã đăng bài thành công (Không có nội dung bình luận).`, 'success');
        await this._logToDB(`Đã đăng bài thành công.`, 'success');
      }

      this._assertRunning();

      if (this.db.flush) await this.db.flush();

      this._incrementState();
      await this._updateDBState({
        currentPostIndex: this.state.currentPostIndex,
      });

      return 'next';
    } catch (error) {
      if (error?.isStopped || !this.running) {
        return 'stopped';
      }

      this.onStatus(`${prefix}: Error: ${error.message}`, 'error');
      await this._logToDB(t('backend.status.error_at_group', { group: targetName, message: error.message }), 'error');

      this._incrementState();
      await this._updateDBState({
        currentPostIndex: this.state.currentPostIndex,
      });
      return 'next';
    }
  }

  _incrementState() {
    this.state.currentPostIndex += 1;
  }

  /**
   * Dọn sạch văn bản nháp hoặc ảnh đính kèm còn sót lại trong hộp thoại tạo bài viết (ví dụ từ lần thử trước)
   */
  async _clearComposerDraft(page, composer) {
    try {
      // 1. Gỡ mọi ảnh/video đính kèm còn sót trong hộp thoại
      await page.evaluate(() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return;
        const removeSelectors = [
          'div[aria-label="Gỡ ảnh"]',
          'div[aria-label="Remove photo"]',
          'div[aria-label="Xóa ảnh"]',
          'div[aria-label="Delete photo"]',
          'div[aria-label="Gỡ video"]',
          'div[aria-label="Remove video"]',
          'div[aria-label="Gỡ file đính kèm"]',
          'div[aria-label="Remove attachment"]',
        ];
        const btns = dialog.querySelectorAll(removeSelectors.join(', '));
        btns.forEach((btn) => {
          if (btn instanceof HTMLElement) btn.click();
        });
      });

      // 2. Xóa văn bản nháp nếu có sẵn trong ô soạn thảo
      const stillHasText = await composer.evaluate((el) => {
        const currentText = (el.innerText || '').trim();
        if (currentText.length > 0) {
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          return (el.innerText || '').trim().length > 0;
        }
        return false;
      });

      if (stillHasText) {
        await composer.click().catch(() => {});
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await delay(300);
      }
    } catch {
      // Ignore draft cleanup errors
    }
  }

  async _postToFanpage({ targetUrl, post, prefix }) {
    const { content, imagePath } = post;
    const page = this.sessionPage; // Tái sử dụng sessionPage hiện tại, không mở tab mới

    try {
      this._assertRunning();
      await page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
      await page.setDefaultTimeout(this.config.actionTimeoutMs);
      await this._enableBackgroundExecution(page);

      // Nếu đang ở đúng trang nhưng bị kẹt ở mục Reels, Ảnh, Giới thiệu,... thì chuyển về tab Tất cả / Bài viết
      if (this._isSameProfileOrPage(page.url(), targetUrl)) {
        await this._ensureOnMainPostsTab(page, targetUrl, prefix);
      }

      // Chỉ điều hướng nếu chưa ở trên tường đích, đang ở Trang chủ FB chính, đang ở mục phụ, hoặc trang bị lệch khỏi www.facebook.com
      const rawUrl = page.url() || '';
      const currentUrl = rawUrl.toLowerCase();
      const isOffTargetOrStuck = !currentUrl.includes('www.facebook.com') ||
                                 currentUrl.includes('business.facebook.com') ||
                                 currentUrl.includes('/post/create') ||
                                 this._isOnFacebookHomeFeed(rawUrl) ||
                                 !this._isAtTargetWall(rawUrl, targetUrl);
      const needsNavigation = !this.navigatedToTargetWall || isOffTargetOrStuck;

      if (needsNavigation) {
        this.onStatus(`${prefix}: Điều hướng tới trang đích...`, 'running');
        await page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.navigationTimeoutMs,
        });
        await waitForPageSettled(page);
        await this._dismissLoginModal(page);
        this.navigatedToTargetWall = true;
      } else {
        this.onStatus(`${prefix}: Đang ở đúng trang đích. Chuẩn bị đăng bài...`, 'running');
        await page.keyboard.press('Escape').catch(() => {});
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
        await delay(1000);
      }

      this._assertRunning();
      await this._ensureOnMainPostsTab(page, targetUrl, prefix);
      this.onStatus(`${prefix}: Đang chờ trang tải ổn định...`, 'running');
      await delay(1500);

      const composer = await openComposer(page, this.config.actionTimeoutMs, (msg) => {
        this.onStatus(`${prefix}: ${msg}`, 'running');
      });

      this._assertRunning();
      await this._clearComposerDraft(page, composer);

      // 1. Nhập nội dung bài viết TRƯỚC
      if (content) {
        this._assertRunning();
        this.onStatus(`${prefix}: Đang nhập nội dung bài viết...`, 'running');
        await composer.click();
        await composer.evaluate((el) => el.focus());
        await delay(400);

        // Dùng CDP Input.insertText để giữ nguyên các dòng trống
        const contentCdp = await page.target().createCDPSession();
        await contentCdp.send('Input.insertText', { text: content });
        await contentCdp.detach();

        await delay(1800); // Đợi nội dung hiển thị
      }

      // 2. Khôi phục ảnh tạm nếu cần hoặc tải từ Trello
      let effectiveImagePath = post.imagePath || imagePath;
      let tempFilePath = null;
      if ((!effectiveImagePath || !fs.existsSync(effectiveImagePath)) && (post.trelloCardId || post.imageUrl)) {
        this._assertRunning();
        this.onStatus(`${prefix}: Đang tải ảnh trực tiếp từ Trello...`, 'running');
        try {
          const { downloadCardImageDirect } = require('../ipc/trello');
          const res = await downloadCardImageDirect(post.trelloCardId, post.trelloCardName || post.content.slice(0, 30), post.imageUrl);
          if (res && res.filePath) {
            effectiveImagePath = res.filePath;
            post.imagePath = res.filePath;
          }
        } catch (e) {
          this.onStatus(`${prefix}: Cảnh báo tải ảnh Trello: ${e.message}`, 'warning');
        }
      } else if (post.imageBase64 && (!effectiveImagePath || !fs.existsSync(effectiveImagePath))) {
        this._assertRunning();
        this.onStatus(`${prefix}: Đang khôi phục ảnh từ hàng đợi...`, 'running');
        try {
          const tempDir = path.join(require('electron').app.getPath('userData'), 'temp_images');
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          tempFilePath = path.join(tempDir, `upload_${Date.now()}.jpg`);
          const base64Data = post.imageBase64.replace(/^data:image\/\w+;base64,/, "");
          fs.writeFileSync(tempFilePath, Buffer.from(base64Data, 'base64'));
          effectiveImagePath = tempFilePath;
        } catch (e) {
          this.onStatus(`${prefix}: Lỗi khôi phục ảnh: ${e.message}`, 'error');
        }
      }

      // 3. Upload ảnh SAU CÙNG bằng cách dán trực tiếp ảnh vào (không dùng OS clipboard, đảm bảo chỉ dán đúng 1 ảnh)
      if (effectiveImagePath) {
        this._assertRunning();
        this.onStatus(`${prefix}: Đang dán ảnh trực tiếp vào bài viết...`, 'running');
        try {
          // Gỡ ảnh đính kèm nếu hộp thoại vô tình đã có sẵn ảnh trước đó
          await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            if (!dialog) return;
            const removeBtns = dialog.querySelectorAll(
              'div[aria-label="Gỡ ảnh"], div[aria-label="Remove photo"], div[aria-label="Xóa ảnh"], div[aria-label="Delete photo"]'
            );
            removeBtns.forEach((btn) => {
              if (btn instanceof HTMLElement) btn.click();
            });
          });

          await composer.click();
          await composer.evaluate((el) => el.focus());
          await delay(400);
          
          // Đọc file ảnh dưới dạng base64
          const ext = path.extname(effectiveImagePath).toLowerCase();
          let fileMime = 'image/jpeg';
          if (ext === '.png') fileMime = 'image/png';
          else if (ext === '.gif') fileMime = 'image/gif';
          else if (ext === '.webp') fileMime = 'image/webp';
          const imgData = fs.readFileSync(effectiveImagePath, { encoding: 'base64' });
          const dataUrl = `data:${fileMime};base64,${imgData}`;

          // Tạo sự kiện paste giả lập bằng JavaScript để bypass OS clipboard
          await composer.evaluate(async (element, base64Url, mimeType) => {
            const res = await fetch(base64Url);
            const blob = await res.blob();
            const file = new File([blob], "upload_image.jpg", { type: mimeType });

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            const pasteEvent = new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
              clipboardData: dataTransfer
            });

            element.focus();
            element.dispatchEvent(pasteEvent);
          }, dataUrl, fileMime);

          this.onStatus(`${prefix}: Đã chèn ảnh thành công, chờ Facebook tải ảnh lên...`, 'running');
          await delay(4500);
        } catch (e) {
          this.onStatus(`${prefix}: Lỗi khi upload ảnh: ${e.message}`, 'error');
        }
      }

      this._assertRunning();
      await this._clickPostButton(page, prefix);

      return { page };
    } catch (error) {
      if (!error?.isStopped && this.running) {
        const screenshotPath = await saveDebugScreenshot(page, this.sessionDir);
        if (screenshotPath) {
          this.onStatus(`${prefix}: Error screenshot: ${screenshotPath}`, 'error');
        }
        // Đóng hộp thoại nếu đăng lỗi
        await page.keyboard.press('Escape').catch(() => {});
      }
      throw error;
    }
  }

  async _clickPostButton(page, prefix = '') {
    const startedAt = Date.now();
    let clickedPost = false;

    // 1. Try to click "Next" / "Tiếp" inside dialog (New Fanpage Flow)
    const clickedNext = await page.evaluate(() => {
      const scope = document.querySelector('div[role="dialog"]') || document;
      const buttons = Array.from(scope.querySelectorAll('div[role="button"], span[role="button"]'));
      for (const button of buttons) {
        const text = (button.innerText || '').trim().toLowerCase();
        if ((text === 'next' || text === 'tiếp') && button.getAttribute('aria-disabled') !== 'true') {
          button.click();
          return true;
        }
      }
      return false;
    });

    if (clickedNext) {
      // Wait for the "Post Settings" screen to load
      await delay(2000);
    }

    // 2. Click "Post" / "Đăng"
    while (Date.now() - startedAt < 25000) {
      this._assertRunning();
      clickedPost = await page.evaluate(() => {
        const scope = document.querySelector('div[role="dialog"]') || document;
        const buttons = Array.from(scope.querySelectorAll('div[role="button"], span[role="button"]'));
        for (const button of buttons) {
          const text = (button.innerText || '').trim().toLowerCase();
          if (text === 'post' || text === 'đăng') {
            const isDisabled = button.getAttribute('aria-disabled') === 'true';
            if (!isDisabled) {
              button.click();
              return 'success';
            }
            return 'disabled'; // Nút vẫn còn mờ (ví dụ đang tải ảnh)
          }
        }
        return 'not_found';
      });

      if (clickedPost === 'success') {
        clickedPost = true;
        break;
      }
      
      await delay(1000);
    }

    if (clickedPost !== true) {
      throw new Error(t('backend.errors.post_button'));
    }

    // 3. Đợi hộp thoại tạo bài viết thực sự hoàn tất đăng và đóng lại (tối đa 45s)
    if (prefix) {
      this.onStatus(`${prefix}: Đã bấm Đăng, đang đợi Facebook xử lý và hiển thị bài viết...`, 'running');
    }
    const publishWaitStart = Date.now();
    let dialogClosed = false;

    while (Date.now() - publishWaitStart < 45000) {
      this._assertRunning();
      await delay(1000);

      const dialogState = await page.evaluate(() => {
        // Tự động bấm qua các hộp thoại phụ của Facebook sau khi bấm Đăng (Lúc khác / Not now / Bỏ qua / Đăng bài viết gốc / Đăng ở bước 2)
        const promptTexts = [
          'not now',
          'lúc khác',
          'bỏ qua',
          'skip',
          'đăng bài viết gốc',
          'post original post',
        ];
        const dialogButtons = Array.from(
          document.querySelectorAll('div[role="dialog"] div[role="button"], div[role="dialog"] span[role="button"], div[role="dialog"] button')
        );
        for (const btn of dialogButtons) {
          const txt = (btn.innerText || '').trim().toLowerCase();
          if (promptTexts.includes(txt) && btn.getAttribute('aria-disabled') !== 'true') {
            btn.click();
            return 'clicked_prompt';
          }
        }

        // Kiểm tra xem hộp thoại Tạo bài viết còn đang mở hay đang tải lên không
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
        const hasActiveComposerDialog = dialogs.some((d) => {
          const style = window.getComputedStyle(d);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = d.getBoundingClientRect();
          if (rect.width < 50 || rect.height < 50) return false;
          const hasEditor = d.querySelector('[contenteditable="true"], [role="textbox"]');
          const dialogText = (d.innerText || '').toLowerCase();
          const isPublishingDialog =
            dialogText.includes('tạo bài viết') ||
            dialogText.includes('create post') ||
            dialogText.includes('cài đặt bài viết') ||
            dialogText.includes('post settings') ||
            dialogText.includes('đang đăng') ||
            dialogText.includes('posting');
          return Boolean(hasEditor || isPublishingDialog);
        });

        return hasActiveComposerDialog ? 'still_open' : 'closed';
      });

      if (dialogState === 'closed') {
        dialogClosed = true;
        break;
      }
    }

    if (!dialogClosed) {
      throw new Error('Quá thời gian chờ Facebook hoàn tất đăng bài (hộp thoại tạo bài viết chưa đóng).');
    }

    // Đợi thêm 4.5s để Facebook xử lý và render bài viết mới lên đầu tường Fanpage
    await delay(4500);
  }

  /**
   * Tìm chính xác bài viết vừa đăng trên tường (khớp nội dung post.content) và viết đúng 1 bình luận vào bài đó.
   * Tuyệt đối không bình luận nhầm vào bài viết thứ 2 / bài cũ khác trên tường.
   */
  async _commentOnNewPost({ postPage, post, commentText, targetUrl, prefix }) {
    this._assertRunning();
    this.onStatus(`${prefix}: Đang đợi bài viết mới hiển thị trên tường để viết bình luận...`, 'running');

    const normalizeForMatch = (str) =>
      (str || '')
        .normalize('NFKC')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const fullNorm = normalizeForMatch(post.content || '');
    const allWords = fullNorm.split(' ').filter(Boolean);
    // Cụm từ mở đầu chính xác (8 từ đầu tiên, tương đương ~45-60 ký tự đầu của bài viết)
    const exactPhrase = allWords.slice(0, Math.min(8, allWords.length)).join(' ');
    const shortPhrase = allWords.slice(0, Math.min(5, allWords.length)).join(' ');

    const stopWords = new Set([
      'breaking', 'news', 'update', 'just', 'the', 'and', 'for', 'with',
      'from', 'that', 'this', 'after', 'his', 'her', 'their', 'our', 'new',
    ]);
    const specificTokens = allWords
      .slice(0, 35)
      .filter((w) => w.length >= 3 && !stopWords.has(w))
      .slice(0, 12);

    await postPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
    await delay(2000);

    let stepIdx = 0;
    let footerScrollCount = 0;
    let reloadCount = 0;
    let box = null;
    const commentStart = Date.now();
    const totalWaitMs = 45000;

    while (Date.now() - commentStart < totalWaitMs) {
      this._assertRunning();

      const searchHandle = await postPage.evaluateHandle(
        ({ phrase8, phrase5, tokens, footerStep }) => {
          const isVisibleEl = (el) => {
            if (!(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 10 && rect.height > 10;
          };

          const normText = (str) =>
            (str || '')
              .normalize('NFKC')
              .replace(/https?:\/\/\S+/gi, ' ')
              .replace(/[^\p{L}\p{N}]+/gu, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();

          const isCommentBox = (el) => {
            if (!isVisibleEl(el)) return false;
            if (el.closest('div[role="dialog"]')) return false;
            const label = (el.getAttribute('aria-label') || '').toLowerCase();
            const placeholder = (el.getAttribute('aria-placeholder') || '').toLowerCase();
            const combined = `${label} ${placeholder}`;
            return (
              combined.includes('bình luận dưới tên') ||
              combined.includes('comment as') ||
              combined.includes('viết bình luận') ||
              combined.includes('write a comment') ||
              combined.includes('bình luận') ||
              combined.includes('comment')
            );
          };

          const matchesTargetPost = (rawText) => {
            const norm = normText(rawText);
            if (!norm || norm.length < 8) return false;

            // 1. Đối chiếu chính xác cụm 8 từ đầu tiên của bài viết mới
            if (phrase8 && phrase8.length >= 18 && norm.includes(phrase8)) {
              return true;
            }

            // 2. Nếu bài viết có từ khóa đặc trưng: yêu cầu khớp cả cụm 5 từ đầu VÀ >= 85% từ khóa đặc trưng
            if (tokens && tokens.length >= 4) {
              if (phrase5 && phrase5.length >= 12 && !norm.includes(phrase5)) {
                return false;
              }
              const minMatches = Math.max(4, Math.ceil(tokens.length * 0.85));
              let matched = 0;
              for (const t of tokens) {
                if (norm.includes(t)) matched++;
              }
              return matched >= minMatches;
            }

            if (phrase5 && phrase5.length > 0) {
              return norm.includes(phrase5);
            }

            return false;
          };

          // Bước 1: Tìm phần tử caption của bài viết vừa đăng trên tường (ngoài dialog)
          const rawCandidates = Array.from(
            document.querySelectorAll(
              'div[data-ad-preview="message"], div[data-ad-comet-preview="message"], div[dir="auto"], span[dir="auto"]'
            )
          ).filter((el) => {
            if (!isVisibleEl(el)) return false;
            if (el.closest('div[role="dialog"], [role="banner"], [role="navigation"]')) return false;
            const txt = (el.innerText || '').trim();
            if (txt.length < 8 || txt.length > 3000) return false;
            return matchesTargetPost(txt);
          });

          if (rawCandidates.length === 0) {
            return { status: 'post_not_on_wall_yet', element: null };
          }

          // Loại bỏ các thẻ cha bao ngoài nếu bên trong đã có thẻ con khớp trực tiếp
          const leafCandidates = rawCandidates.filter(
            (el) => !rawCandidates.some((other) => other !== el && el.contains(other))
          );
          const pool = leafCandidates.length > 0 ? leafCandidates : rawCandidates;

          // Luôn chọn bài khớp nằm ở vị trí CAO NHẤT trên tường (top nhỏ nhất), tuyệt đối không chọn bài bên dưới
          pool.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
          const captionEl = pool[0];

          // Bước 2: Xác định ranh giới bắt đầu của bài viết thứ 2 ngay bên dưới captionEl
          // Mọi nút menu 3 chấm của bài viết tiếp theo, tiêu đề bài tiếp theo, hoặc caption của bài tiếp theo đều là ranh giới cứng!
          const isAfterCaption = (el) =>
            el !== captionEl &&
            !captionEl.contains(el) &&
            !el.contains(captionEl) &&
            Boolean(captionEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);

          const nextPostBoundaries = [];

          // 2a. Các menu 3 chấm ("Hành động với bài viết này" / aria-haspopup="menu") nằm sau captionEl
          // (vì menu 3 chấm của bài số 1 luôn nằm PHÍA TRÊN captionEl, nên menu 3 chấm đầu tiên phía dưới captionEl chính là Header của bài số 2!)
          const menuBtns = Array.from(
            document.querySelectorAll('div[role="button"][aria-haspopup="menu"], div[role="button"][aria-label]')
          ).filter((btn) => {
            if (!isVisibleEl(btn) || btn.closest('div[role="dialog"], [role="banner"]')) return false;
            if (!isAfterCaption(btn)) return false;
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const hasPopup = btn.getAttribute('aria-haspopup') === 'menu';
            return (
              hasPopup ||
              aria.includes('hành động với bài viết') ||
              aria.includes('actions for this post')
            );
          });
          nextPostBoundaries.push(...menuBtns);

          // 2b. Các khối nội dung bài viết (message preview) của bài tiếp theo nằm sau captionEl
          const otherMessages = Array.from(
            document.querySelectorAll('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]')
          ).filter((el) => isVisibleEl(el) && isAfterCaption(el));
          nextPostBoundaries.push(...otherMessages);

          // 2c. Nút "Chia sẻ" / "Share" thứ 2 trở đi sau captionEl (mỗi bài chỉ có 1 nút Chia sẻ)
          const shareBtnsAfterCaption = Array.from(
            document.querySelectorAll('div[role="button"], span[role="button"]')
          ).filter((btn) => {
            if (!isVisibleEl(btn) || btn.closest('div[role="dialog"]')) return false;
            if (!isAfterCaption(btn)) return false;
            const txt = (btn.innerText || '').trim().toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
            return (
              txt === 'chia sẻ' ||
              txt === 'share' ||
              aria.includes('gửi nội dung này cho bạn bè hoặc đăng trên trang cá nhân') ||
              aria.includes('send this to friends or post it on your profile')
            );
          });
          if (shareBtnsAfterCaption.length >= 2) {
            nextPostBoundaries.push(shareBtnsAfterCaption[1]);
          }

          // Hàm kiểm tra phần tử targetEl có nằm TRƯỚC ranh giới bài viết thứ 2 hay không
          const isStrictlyInFirstPost = (targetEl) => {
            if (!isAfterCaption(targetEl)) return false;
            for (const bound of nextPostBoundaries) {
              if (bound === targetEl || bound.contains(targetEl)) return false;
              // Nếu bound xuất hiện TRƯỚC targetEl trong DOM -> targetEl đã lọt sang bài viết thứ 2!
              if (Boolean(bound.compareDocumentPosition(targetEl) & Node.DOCUMENT_POSITION_FOLLOWING)) {
                return false;
              }
            }
            return true;
          };

          // Bước 3: Chỉ tìm ô bình luận và nút Bình luận nằm TRONG PHẠM VI bài viết vừa đăng (trước bài thứ 2)
          const boxesInNewPost = Array.from(document.querySelectorAll('div[role="textbox"]'))
            .filter(isCommentBox)
            .filter(isStrictlyInFirstPost);

          const commentBtnsInNewPost = Array.from(
            document.querySelectorAll('div[role="button"], span[role="button"]')
          )
            .filter((btn) => {
              if (!isVisibleEl(btn) || btn.closest('div[role="dialog"]')) return false;
              const txt = (btn.innerText || '').trim().toLowerCase();
              const aria = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
              return (
                txt === 'bình luận' ||
                txt === 'comment' ||
                aria === 'bình luận' ||
                aria === 'comment' ||
                aria === 'viết bình luận' ||
                aria === 'leave a comment'
              );
            })
            .filter(isStrictlyInFirstPost);

          if (boxesInNewPost.length > 0) {
            return { status: 'found_textbox', element: boxesInNewPost[0] };
          }

          if (commentBtnsInNewPost.length > 0) {
            const targetBtn = commentBtnsInNewPost[0];
            targetBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            targetBtn.click();
            return { status: 'clicked_expand', element: null };
          }

          // Nếu đã thấy bài mới nhưng chưa thấy nút/ô bình luận (do ảnh dài che khuất hoặc Facebook đang hoàn tất render chân bài viết)
          captionEl.scrollIntoView({ behavior: 'instant', block: 'start' });
          window.scrollBy(0, 420 + footerStep * 220);
          return { status: 'scrolling_to_footer', element: null };
        },
        {
          phrase8: exactPhrase,
          phrase5: shortPhrase,
          tokens: specificTokens,
          footerStep: footerScrollCount,
        }
      );

      const status = await searchHandle.evaluate((res) => res?.status || 'not_found').catch(() => 'not_found');

      if (status === 'found_textbox') {
        const elementProp = await searchHandle.getProperty('element');
        box = elementProp.asElement();
        await searchHandle.dispose().catch(() => {});
        if (box) break;
      } else {
        await searchHandle.dispose().catch(() => {});
      }

      if (status === 'clicked_expand') {
        await delay(1400);
        continue;
      }

      if (status === 'scrolling_to_footer') {
        footerScrollCount = (footerScrollCount + 1) % 4;
        await delay(1400);
        // Nếu đã thấy bài mới nhưng sau 18s vẫn chưa hiện thanh Bình luận (trạng thái Đang đăng bị kẹt), tải lại trang 1 lần
        if (reloadCount === 0 && Date.now() - commentStart >= 18000) {
          reloadCount++;
          this.onStatus(`${prefix}: Đang làm mới trang để hiển thị đầy đủ ô bình luận của bài mới...`, 'running');
          await postPage.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: this.config.navigationTimeoutMs,
          }).catch(() => {});
          await waitForPageSettled(postPage);
          await this._dismissLoginModal(postPage);
          await this._ensureOnMainPostsTab(postPage, targetUrl, prefix);
          await delay(2500);
        }
        continue;
      }

      // Bài viết mới chưa xuất hiện trên tường: cuộn nhẹ ở đầu tường
      stepIdx++;
      if (stepIdx % 3 === 0) {
        await postPage.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })).catch(() => {});
      } else {
        await postPage.evaluate(() => window.scrollBy(0, 250)).catch(() => {});
      }
      await delay(1500);

      // Nếu sau 7 giây (hoặc lần 2 ở 22 giây) bài viết mới vẫn chưa được Facebook render lên tường, làm mới trang tường đích để nạp bài vừa đăng
      const elapsed = Date.now() - commentStart;
      if ((reloadCount === 0 && elapsed >= 7000) || (reloadCount === 1 && elapsed >= 22000)) {
        reloadCount++;
        this.onStatus(`${prefix}: Bài viết mới chưa hiển thị trên tường, đang tải lại trang (lần ${reloadCount})...`, 'running');
        await postPage.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.navigationTimeoutMs,
        }).catch(() => {});
        await waitForPageSettled(postPage);
        await this._dismissLoginModal(postPage);
        await this._ensureOnMainPostsTab(postPage, targetUrl, prefix);
        await delay(2500);
      }
    }

    if (box) {
      this._assertRunning();
      this.onStatus(`${prefix}: Đã xác định đúng bài viết vừa đăng. Đang cuộn tới ô bình luận...`, 'running');
      await postPage.evaluate((el) => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, box);
      await delay(1000);

      await box.click({ delay: 30 }).catch(() => {});
      await postPage.evaluate((el) => {
        el.focus();
        // Xóa sạch text thừa nếu có trong ô comment trước khi chèn
        if ((el.innerText || '').trim().length > 0) {
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        }
      }, box);
      await delay(500);

      this._assertRunning();
      this.onStatus(`${prefix}: Đang nhập bình luận: "${commentText}"`, 'running');

      // Dùng CDP Input.insertText — inject thẳng vào browser, không dùng OS clipboard
      const commentCdp = await postPage.target().createCDPSession();
      await commentCdp.send('Input.insertText', { text: commentText });
      await commentCdp.detach();
      await delay(1000);

      this._assertRunning();
      this.onStatus(`${prefix}: Đang gửi bình luận...`, 'running');
      await postPage.keyboard.press('Enter');
      await delay(3500);

      this.onStatus(`${prefix}: Đã tự động đăng bài & viết bình luận thành công.`, 'success');
      await this._logToDB(`Đã đăng bài & viết bình luận thành công: "${commentText}"`, 'success');
    } else {
      this.onStatus(`${prefix}: Không tìm thấy bài viết vừa đăng trên tường để bình luận (đã chặn bình luận nhầm vào bài khác).`, 'warning');
      await this._logToDB(`Đã đăng bài thành công (Chưa tìm thấy bài mới trên tường để bình luận).`, 'success');
    }
  }

  async _updateDBState(newState) {
    if (this.db && this.queueId) {
      await this.db.updateQueueState(this.queueId, newState);
      await this._pushQueueUpdate();
    }
  }

  async _logToDB(message, type = 'info') {
    if (this.db && this.queueId) {
      await this.db.addQueueLog(this.queueId, { message, type });
      await this._pushQueueUpdate();
    }
  }

  async _pushQueueUpdate() {
    try {
      const freshQueue = await this.db.getQueueById(this.queueId);
      if (freshQueue) {
        this.onQueueUpdate(this.queueId, freshQueue);
      }
    } catch {
      // Non-critical — UI will self-heal on next poll
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

  async _dismissLoginModal(page) {
    try {
      const buttonHandle = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
        for (const button of buttons) {
          const text = (button.innerText || '').trim().toLowerCase();
          if (text.includes('continue as ') || text.includes('tiếp tục d') || text.includes('tiếp tục với')) {
            return button;
          }
        }
        const dialog = document.querySelector('div[role="dialog"]');
        if (dialog) {
          const closeButton = dialog.querySelector('div[aria-label="Close"], div[aria-label="Đóng"]');
          if (closeButton && closeButton.getAttribute('role') === 'button') {
            return closeButton;
          }
        }
        return null;
      });
      const button = buttonHandle.asElement();
      if (button) {
        await button.click({ delay: 50 });
        await delay(6000);
      }
    } catch {
      // Ignore
    }
  }
}

module.exports = PostQueueController;
