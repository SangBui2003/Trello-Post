const { t } = require('../utils/i18n');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { facebook: defaultConfig } = require('../config');
const { launchStealthBrowser } = require('../browser/BrowserLauncher');
const { PageSwitcher } = require('../page-handler');
const { waitForPageSettled } = require('../post-group/utils/dom');
const { openComposer } = require('../post-group/actions/ComposerLocator');
const { fillComposer } = require('../post-group/actions/ComposerTyper');
const { resolveImageFileInput } = require('../post-group/actions/MediaUploader');
const { delay } = require('../post-group/utils/helpers');
const { saveDebugScreenshot } = require('../post-group/utils/debug');

class PostQueueController {
  constructor({
    queueId,
    queue,
    profile,
    groups,
    sessionDir,
    db,
    onStatus = () => { },
    onNotify = () => { },
    onQueueUpdate = () => { },
    config = defaultConfig,
  }) {
    this.queueId = queueId;
    this.queue = queue;
    this.profile = profile;
    this.groups = groups;
    this.sessionDir = sessionDir;
    this.db = db;
    this.onStatus = onStatus;
    this.onNotify = onNotify;
    this.onQueueUpdate = onQueueUpdate;
    this.config = config;

    this.browser = null;
    this.sessionPage = null;
    this.running = false;
    this.roundTimer = null;

    // Manual approval promise
    this.approvalResolver = null;
    this.approvalPage = null;

    // Initialize state from queue data
    const savedState = this.queue.state || {};
    this.state = {
      currentPostIndex: typeof savedState.currentPostIndex === 'number' ? savedState.currentPostIndex : 0,
    };
  }

  async start() {
    this.running = true;

    await this._initBrowser();
    await this._prepareSession();

    this._runLoop().catch(error => {
      this.onStatus(`[${this.queue.name}] ${t('backend.status.loop_error', { message: error.message })}`, 'error');
      this._logToDB(t('backend.status.system_loop_error', { message: error.message }), 'error');
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

    // Resolve any pending approval to allow the loop to finish properly
    if (this.approvalResolver) {
      this.approvalResolver(false);
      this.approvalResolver = null;
    }
    this.approvalPage = null;

    await this._closeBrowser();
    await this._updateDBState({ status: 'idle' });
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

    this.browser = await launchStealthBrowser({
      headless: false,
      defaultViewport: null,
    });

    const pages = await this.browser.pages();
    this.sessionPage = pages[0] || (await this.browser.newPage());

    await this.sessionPage.bringToFront();
    await this.sessionPage.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    await this.sessionPage.setDefaultTimeout(this.config.actionTimeoutMs);
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
      this.onStatus(`[${this.queue.name}] ${t('backend.status.posting_personal')}`, 'info');
    }
  }

  async _runLoop() {
    while (this.running) {
      try {
        const result = await this._executeStep();
        if (result === 'completed') {
          this.onStatus(`[${this.queue.name}] ${t('backend.status.finished_posting')}`, 'success');
          await this._logToDB(t('backend.status.success_posted'), 'success');
          if (this.db.flush) await this.db.flush();

          this.onStatus(`[${this.queue.name}] Đã đăng xong! Trình duyệt được giữ mở để bạn kiểm tra. Vui lòng bấm Dừng hoặc tắt Chrome để kết thúc.`, 'info');
          // DO NOT stop() so the browser stays open for user verification.
          this.running = false; // Stop the loop but keep browser alive
          break;
        } else if (result === 'stopped') {
          this.onStatus(`[${this.queue.name}] ${t('backend.status.queue_stopped')}`, 'info');
          await this._logToDB(t('backend.status.queue_stopped'), 'info');
          await this.stop();
          break;
        }
      } catch (error) {
        this.onStatus(`[${this.queue.name}] Error: ${error.message}`, 'error');
      }

      if (!this.running) break;

      if (!this.running) break;

      const approvalMode = !!this.queue.approvalMode;
      const nextIndex = this.state.currentPostIndex;
      
      if (nextIndex >= this.queue.posts.length) {
        continue;
      }

      const nextPost = this.queue.posts[nextIndex];
      const hasSchedule = nextPost && nextPost.enableSchedule && nextPost.scheduledTime;

      if (approvalMode) {
        this.onStatus(`[${this.queue.name}] Chuyển sang bài đăng tiếp theo...`, 'info');
      } else if (hasSchedule) {
        this.onStatus(`[${this.queue.name}] Chuyển sang bài đăng tiếp theo (có hẹn giờ)...`, 'info');
      } else {
        this.onStatus(`[${this.queue.name}] Đã đăng tự động. Chờ bạn nhấn 'Tiếp tục' để qua bài tiếp theo (tránh spam).`, 'info');
        await this._updateDBState({ status: 'pending_approval' });
        const approved = await new Promise(resolve => {
          this.approvalResolver = resolve;
        });
        if (!approved) {
          this.onStatus(`[${this.queue.name}] ${t('backend.status.queue_stopped')}`, 'info');
          await this._logToDB(t('backend.status.queue_stopped'), 'info');
          await this.stop();
          break;
        }
      }
    }
  }

  async _executeStep() {
    const { posts, pageIdentity } = this.queue;
    const approvalMode = !!this.queue.approvalMode;

    if (!posts || posts.length === 0) throw new Error(t('backend.errors.no_posts'));

    const pIndex = this.state.currentPostIndex;

    if (pIndex >= posts.length) {
      return 'completed';
    }

    const post = posts[pIndex];
    const targetUrl = (!pageIdentity || pageIdentity === 'personal') ? 'https://www.facebook.com' : pageIdentity;
    const targetName = (!pageIdentity || pageIdentity === 'personal') ? 'Personal Wall' : 'Fanpage Wall';

    const stepLabel = `Post ${pIndex + 1}/${posts.length}`;
    const prefix = `[${this.queue.name}] [${stepLabel}]`;

    if (post.enableSchedule && post.scheduledTime) {
      const targetTime = new Date(post.scheduledTime).getTime();
      const now = Date.now();
      const waitMs = targetTime - now;
      if (waitMs > 0) {
        const targetStr = new Date(targetTime).toLocaleString('vi-VN', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
        this.onStatus(`${prefix}: Đang chờ đến giờ hẹn: ${targetStr}`, 'info');
        await this._updateDBState({ status: 'waiting' });
        await this._waitInterval(waitMs);
        if (!this.running) return 'stopped';
      }
    }

    this.onStatus(`${prefix}: ${t('backend.status.preparing')}`, 'running');
    await this._updateDBState({ status: 'running' });

    try {
      let postUrl = null;
      let postPage = null;
      let attempt = 1;
      const maxAttempts = 2;
      let postError = null;

      while (attempt <= maxAttempts) {
        try {
          const result = await this._postToFanpage({
            targetUrl,
            post,
            prefix: attempt > 1 ? `${prefix} [Retry]` : prefix,
            approvalMode,
          });
          postPage = result.page;
          postError = null;
          break; // Thành công
        } catch (error) {
          postError = error;
          this.onStatus(`${prefix}: Lỗi lần ${attempt} (${error.message}).`, 'warning');
          attempt++;
          if (attempt <= maxAttempts) {
            this.onStatus(`${prefix}: Đang đóng tab lỗi và tạo tab mới để thử lại bài này...`, 'info');
            await delay(3000);
          }
        }
      }

      if (postError) {
        throw postError; // Ném ra ngoài nếu thất bại cả 2 lần
      }

      if (approvalMode) {
        this.onStatus(`${prefix}: ${t('backend.status.waiting_manual')}`, 'info');
        await this._updateDBState({ status: 'pending_approval' });
        this.onNotify(t('backend.status.approval_required', { name: this.queue.name }));

        // Store reference to tab pending approval
        this.approvalPage = postPage;

        // Wait for IPC signal (user clicks Continue)
        const approved = await new Promise(resolve => {
          this.approvalResolver = resolve;
        });

        // Xóa reference sau khi xong
        const pageToClose = this.approvalPage;
        this.approvalPage = null;

        if (!approved) {
          if (pageToClose) await pageToClose.close().catch(() => { });
          return 'stopped';
        }

        this.onStatus(`${prefix}: Đã đăng thành công bài viết.`, 'success');
        await this._logToDB(`Đã đăng bài viết ${stepLabel} thành công.`, 'success');
        if (pageToClose) await pageToClose.close().catch(() => { });
      } else {
        this.onStatus(`${prefix}: Chờ 6s bài viết được tải lên...`, 'running');
        await delay(6000);

        this.onStatus(`${prefix}: Đang cuộn xuống để tìm ô bình luận...`, 'running');
        await postPage.evaluate(() => {
          window.scrollBy(0, 500);
        });
        await delay(2000);

        // Find comment textbox with "Bình luận dưới tên" or "Comment as"
        let commentBoxHandle = await postPage.evaluateHandle(() => {
          const textboxes = Array.from(document.querySelectorAll('div[role="textbox"]'));
          let target = textboxes.find(box => {
            const label = (box.getAttribute('aria-label') || '').toLowerCase();
            return label.includes('bình luận dưới tên') || label.includes('comment as');
          });
          if (!target) {
            target = textboxes.find(box => {
              const label = (box.getAttribute('aria-label') || '').toLowerCase();
              return label.includes('bình luận') || label.includes('comment') || label.includes('write') || label.includes('viết');
            });
          }
          return target || null;
        });

        let box = commentBoxHandle.asElement();
        if (!box) {
          // If not found, try reloading the page
          this.onStatus(`${prefix}: Không tìm thấy ô bình luận, đang tải lại trang...`, 'running');
          await postPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await delay(3000);
          await postPage.evaluate(() => {
            window.scrollBy(0, 500);
          });
          await delay(2000);

          commentBoxHandle = await postPage.evaluateHandle(() => {
            const textboxes = Array.from(document.querySelectorAll('div[role="textbox"]'));
            let target = textboxes.find(box => {
              const label = (box.getAttribute('aria-label') || '').toLowerCase();
              return label.includes('bình luận dưới tên') || label.includes('comment as');
            });
            if (!target) {
              target = textboxes.find(box => {
                const label = (box.getAttribute('aria-label') || '').toLowerCase();
                return label.includes('bình luận') || label.includes('comment') || label.includes('write') || label.includes('viết');
              });
            }
            return target || null;
          });
          box = commentBoxHandle.asElement();
        }

        if (box) {
          // Use explicit commentText if provided, otherwise extract from the post content
          let commentText = post.commentText || '';
          
          if (!commentText) {
            const content = post.content || '';
            const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
            commentText = lines.find(l => l.includes('http://') || l.includes('https://'));
            
            if (!commentText) {
              // Fallback: if no line with link, check for any link and prepend CTA
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
            this.onStatus(`${prefix}: Đang cuộn ô bình luận vào tầm nhìn...`, 'running');
            await postPage.evaluate((el) => {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, box);
            await delay(1500);

            this.onStatus(`${prefix}: Đang nhập bình luận: "${commentText}"`, 'running');
            await box.focus();
            await delay(800);

            // Dùng CDP Input.insertText — inject thẳng vào browser, không dùng OS clipboard
            const commentCdp = await postPage.target().createCDPSession();
            await commentCdp.send('Input.insertText', { text: commentText });
            await commentCdp.detach();
            await delay(1000);

            this.onStatus(`${prefix}: Đang gửi bình luận...`, 'running');
            await postPage.keyboard.press('Enter');
            await delay(3000);
            
            this.onStatus(`${prefix}: Đã tự động đăng bài & viết bình luận thành công.`, 'success');
            await this._logToDB(`Đã đăng bài & viết bình luận thành công: "${commentText}"`, 'success');
          } else {
            this.onStatus(`${prefix}: Không tìm thấy link trong nội dung để bình luận.`, 'warning');
            await this._logToDB(`Đã đăng bài thành công (Không có link để bình luận).`, 'success');
          }
        } else {
          this.onStatus(`${prefix}: Không tìm thấy ô bình luận trên trang.`, 'warning');
          await this._logToDB(`Đã đăng bài thành công (Không tìm thấy ô bình luận).`, 'success');
        }

        if (this.db.flush) await this.db.flush();
      }

      this._incrementState();
      await this._updateDBState({
        currentPostIndex: this.state.currentPostIndex,
      });

      return 'next';
    } catch (error) {
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

  async _postToFanpage({ targetUrl, post, prefix, approvalMode }) {
    const { content, imagePath } = post;
    const page = await this.browser.newPage();

    const { acquireClipboardLock } = require('../ipc/helpers');
    const releaseClipboard = await acquireClipboardLock();

    try {
      await page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
      await page.setDefaultTimeout(this.config.actionTimeoutMs);
      await page.bringToFront();

      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.navigationTimeoutMs,
      });

      await waitForPageSettled(page);
      await this._dismissLoginModal(page);

      if (page.url().includes('/login')) {
        throw new Error(t('backend.errors.facebook_login'));
      }

      const composer = await openComposer(page, this.config.actionTimeoutMs, (msg) => {
        this.onStatus(`${prefix}: ${msg}`, 'running');
      });

      // 1. Upload Image via Clipboard (More stable for Facebook's complex UI)
      let effectiveImagePath = imagePath;
      if (post.imageBase64 && (!effectiveImagePath || !fs.existsSync(effectiveImagePath))) {
        this.onStatus(`${prefix}: Đang khôi phục ảnh từ hàng đợi...`, 'running');
        try {
          const buffer = Buffer.from(post.imageBase64.split(',')[1], 'base64');
          const tempPath = path.join(os.tmpdir(), `trello_post_${Date.now()}.jpg`);
          fs.writeFileSync(tempPath, buffer);
          effectiveImagePath = tempPath;
        } catch (e) {
          this.onStatus(`${prefix}: Lỗi khôi phục ảnh: ${e.message}`, 'error');
        }
      }

      const { nativeImage, clipboard } = require('electron');

      if (effectiveImagePath || post.imageBase64) {
        this.onStatus(`${prefix}: Đang upload ảnh...`, 'running');

        // Lưu lại nội dung clipboard hiện tại của người dùng để khôi phục sau
        const savedClipboardText = clipboard.readText();
        const savedClipboardImage = clipboard.readImage();

        try {
          let img;
          if (post.imageBase64) {
            img = nativeImage.createFromDataURL(post.imageBase64);
          } else if (effectiveImagePath) {
            img = nativeImage.createFromPath(path.resolve(effectiveImagePath));
          }

          if (img && !img.isEmpty()) {
            clipboard.clear();
            clipboard.writeImage(img);
            await composer.click();
            await delay(1000);

            await this.focus();
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyV');
            await page.keyboard.up('Control');

            this.onStatus(`${prefix}: Đã dán ảnh, chờ load...`, 'running');
            await delay(2000);
          } else {
            this.onStatus(`${prefix}: Không thể đọc ảnh từ file, thử upload thủ công...`, 'warning');
            const fileInputHandle = await page.evaluateHandle(() => {
              const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
              return inputs.length > 0 ? inputs[inputs.length - 1] : null;
            });
            const input = fileInputHandle.asElement();
            if (input) {
              await input.uploadFile(path.resolve(effectiveImagePath));
              await delay(3000);
            }
          }
        } catch (e) {
          this.onStatus(`${prefix}: Lỗi khi upload ảnh: ${e.message}`, 'error');
        } finally {
          // Khôi phục clipboard về trạng thái ban đầu của người dùng
          if (!savedClipboardImage.isEmpty()) {
            clipboard.writeImage(savedClipboardImage);
          } else if (savedClipboardText) {
            clipboard.writeText(savedClipboardText);
          } else {
            clipboard.clear();
          }
        }
      }

      // 2. Nhập nội dung bài viết bằng CDP — không dùng OS clipboard
      if (content) {
        this.onStatus(`${prefix}: Đang nhập nội dung bài viết...`, 'running');
        await composer.click();
        await delay(800);

        // Nếu đã có ảnh trong composer, di chuyển con trỏ xuống cuối trước khi nhập chữ
        if (effectiveImagePath || post.imageBase64) {
          await page.keyboard.press('End');
          await delay(200);
        }

        // Dùng CDP Input.insertText — inject thẳng vào browser engine, không qua OS clipboard
        const contentCdp = await page.target().createCDPSession();
        await contentCdp.send('Input.insertText', { text: content });
        await contentCdp.detach();

        // Nếu không có ảnh, chờ link preview Facebook render
        if (!effectiveImagePath && !post.imageBase64) {
          await delay(6000);
        } else {
          await delay(3000);
        }
      }

      if (!approvalMode) {
        await this._clickPostButton(page);
      }

      return { page };
    } catch (error) {
      const screenshotPath = await saveDebugScreenshot(page, this.sessionDir);
      if (screenshotPath) {
        this.onStatus(`${prefix}: Error screenshot: ${screenshotPath}`, 'error');
      }
      await page.close().catch(() => {});
      throw error;
    } finally {
      // Release clipboard lock so other queues can proceed
      releaseClipboard();
    }
  }

  async _extractPostUrl(page) {
    try {
      return await page.evaluate(() => {
        const allLinks = Array.from(document.querySelectorAll('a[href]'));

        // 1. Find Toast message with "View post" button
        const toastLink = allLinks.find(a => {
          const text = (a.innerText || '').toLowerCase();
          return text.includes('xem bài') || text.includes('view post');
        });
        if (toastLink && toastLink.href) return toastLink.href;

        // 2. Find latest post link (timestamp link)
        // On New Pages Experience, it's often a link with "Vừa xong" or "Just now"
        const timeKeywords = ['vừa xong', 'just now', 'giây', 'sec', 'phút', 'min', '1m', '1p'];
        for (const link of allLinks) {
          const text = (link.innerText || link.getAttribute('aria-label') || '').toLowerCase();
          const href = link.href.toLowerCase();
          const isPostLink = href.includes('/posts/') || href.includes('/permalink/') || href.includes('story_fbid');
          if (isPostLink && timeKeywords.some(kw => text.includes(kw))) {
             return link.href;
          }
        }

        // 3. Check for specific "View" link in professional dashboard
        const viewLink = allLinks.find(a => (a.getAttribute('aria-label') || '').toLowerCase().includes('view post'));
        if (viewLink) return viewLink.href;

        // 4. If Facebook redirects to the post
        if (window.location.href.includes('/posts/') || window.location.href.includes('/permalink/')) {
          return window.location.href;
        }

        // 5. Check for Pending Approval
        const bodyText = document.body.innerText.toLowerCase();
        if (bodyText.includes('đang chờ phê duyệt') || bodyText.includes('pending approval')) {
          return 'pending_approval';
        }

        return null;
      });
    } catch {
      return null;
    }
  }

  async _clickPostButton(page) {
    const startedAt = Date.now();
    let clickedPost = false;

    // 1. Try to click "Next" / "Tiếp" (New Fanpage Flow)
    const clickedNext = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
      for (const button of buttons) {
        const text = (button.innerText || '').trim().toLowerCase();
        if (text === 'next' || text === 'tiếp') {
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
    while (Date.now() - startedAt < 10000) {
      clickedPost = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
        for (const button of buttons) {
          const text = (button.innerText || '').trim().toLowerCase();
          if (text === 'post' || text === 'đăng') {
            button.click();
            return true;
          }
        }
        return false;
      });

      if (clickedPost) break;
      await delay(1000);
    }

    if (!clickedPost) {
      throw new Error(t('backend.errors.post_button'));
    }

    // 3. Handle annoying "Add WhatsApp button" or "Boost Post" popups
    await delay(3000);
    await page.evaluate(() => {
      // Try clicking "Not now" / "Lúc khác" / "Đăng bài viết gốc"
      const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"], a[role="button"]'));
      for (const button of buttons) {
        const text = (button.innerText || '').trim().toLowerCase();
        if (text === 'not now' || text === 'lúc khác' || text === 'bỏ qua' || text === 'skip' || text === 'đăng bài viết gốc' || text === 'post original post') {
          button.click();
          return;
        }
      }

      // Try clicking Close X button on the dialog
      const closeButtons = Array.from(document.querySelectorAll('div[aria-label="Đóng"], div[aria-label="Close"], i[aria-label="Đóng"], i[aria-label="Close"], div[aria-label="Bỏ qua"], div[aria-label="Skip"]'));
      for (const btn of closeButtons) {
        if (btn.offsetParent !== null) { // Only click if visible
          btn.click();
          return;
        }
      }
    });
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

  async _closeBrowser() {
    if (this.browser) {
      await this.browser.close().catch(() => { });
      this.browser = null;
      this.sessionPage = null;
    }
  }
}

module.exports = PostQueueController;
