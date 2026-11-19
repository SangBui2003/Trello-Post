const { t } = require('../../utils/i18n');
const { delay } = require('../utils/helpers');
const { safeClick, isVisible, focusDocument } = require('../utils/dom');

async function waitForComposerEditor(page, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const handle = await page.evaluateHandle(() => {
        const isVisibleElement = (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();

          return (
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.width > 20 &&
            rect.height > 10
          );
        };

        const isCommentOrSearchBox = (element) => {
          const aria = (element.getAttribute('aria-label') || '').toLowerCase();
          const placeholder = (element.getAttribute('aria-placeholder') || '').toLowerCase();
          const combined = `${aria} ${placeholder}`;
          return (
            combined.includes('bình luận') ||
            combined.includes('comment') ||
            combined.includes('trả lời') ||
            combined.includes('reply') ||
            combined.includes('tìm kiếm') ||
            combined.includes('search')
          );
        };

        const dialogEditors = Array.from(
          document.querySelectorAll('[role="dialog"] div[role="textbox"][contenteditable="true"]')
        );
        for (const exactMatch of dialogEditors) {
          if (isVisibleElement(exactMatch) && !isCommentOrSearchBox(exactMatch)) {
            return exactMatch;
          }
        }

        const candidates = Array.from(
          document.querySelectorAll(
            '[role="dialog"] [contenteditable="true"], [role="dialog"] [role="textbox"]'
          )
        );

        let bestElement = null;
        let bestScore = -Infinity;

        for (const element of candidates) {
          if (!isVisibleElement(element) || isCommentOrSearchBox(element)) {
            continue;
          }

          if (!element.closest('[role="dialog"]')) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          let score = 100;

          if ((element.getAttribute('role') || '').toLowerCase() === 'textbox') {
            score += 60;
          }

          if ((element.getAttribute('contenteditable') || '').toLowerCase() === 'true') {
            score += 35;
          }

          if ((element.getAttribute('data-lexical-editor') || '').toLowerCase() === 'true') {
            score += 30;
          }

          if ((element.getAttribute('aria-multiline') || '').toLowerCase() === 'true') {
            score += 15;
          }

          score -= Math.abs(rect.top - 230) * 0.1;

          if (score > bestScore) {
            bestScore = score;
            bestElement = element;
          }
        }

        return bestElement;
      });

      const element = handle.asElement();
      if (element && (await isVisible(element))) {
        return element;
      }

      await handle.dispose();
    } catch (error) {
      // Retry on transient rerender.
    }

    await delay(250);
  }

  throw new Error(t('backend.errors.composer_not_found'));
}

async function tryOpenComposerByShortcut(page) {
  await focusDocument(page);
  await delay(150);
  await page.keyboard.press('Escape').catch(() => {});
  await delay(150);
  await page.keyboard.press('KeyP');
}

async function openComposer(page, timeoutMs, onStatus) {
  let lastError;
  const stepTimeoutMs = Math.min(timeoutMs, 12000);

  const strategies = [
    // Chiến lược 1: Tìm và bấm vào khung "Bạn đang nghĩ gì?"
    async () => {
      onStatus(t('backend.status.searching_composer_btn'));
      const startedAt = Date.now();
      let el = null;
      
      while (Date.now() - startedAt < 10000) {
        const createPostButton = await page.evaluateHandle(() => {
          const isVisibleElement = (element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              style.opacity !== '0' &&
              rect.width > 20 &&
              rect.height > 15
            );
          };

          const texts = ['bạn đang nghĩ gì', 'nghĩ gì', 'tạo bài viết', 'create post', 'viết gì', 'write something', 'mind', 'viết bài'];
          const elements = Array.from(document.querySelectorAll('span, div[role="button"], div.x1i10hfl, div[style*="cursor: pointer"], div[aria-label]'));
          
          for (const el of elements) {
            if (!isVisibleElement(el)) continue;
            if (el.closest('a[href]') || el.closest('[role="banner"], [role="navigation"]')) continue;
            const text = (el.innerText || '').toLowerCase().trim();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase().trim();
            if (texts.some((t) => (text.length > 0 && text.length < 80 && text.includes(t)) || (aria.length > 0 && aria.includes(t)))) {
              const container = el.closest('div[role="button"]') || el.closest('div[tabindex="0"]') || el;
              if (container.closest('a[href]') || container.closest('[role="banner"], [role="navigation"]')) continue;
              return container;
            }
          }

          // Nếu chưa thấy ô đăng bài, kiểm tra xem có đang đứng ở mục phụ (Reels, Ảnh, Giới thiệu, Video...) không để bấm về tab Tất cả / Bài viết
          const mainTabNames = ['bài viết', 'tất cả', 'posts', 'all', 'dòng thời gian', 'timeline'];
          const tabs = Array.from(document.querySelectorAll('[role="tab"]')).filter(
            (tab) => isVisibleElement(tab) && !tab.closest('[role="banner"]') && !tab.closest('[role="dialog"]')
          );
          for (const tab of tabs) {
            const tabText = (tab.innerText || tab.textContent || '').trim().toLowerCase();
            if (mainTabNames.includes(tabText) && tab.getAttribute('aria-selected') === 'false') {
              tab.scrollIntoView({ block: 'center', behavior: 'instant' });
              tab.click();
              window.scrollTo({ top: 0, behavior: 'instant' });
              break;
            }
          }

          return null;
        });

        el = createPostButton.asElement();
        if (el) break;
        await delay(1000);
      }
      
      if (!el) throw new Error(t('backend.errors.direct_selector'));
      await safeClick(page, el);
    },

    // Chiến lược 2: Bấm vào nút "Ảnh/video" (Photo/video) ở ngay cạnh khung soạn thảo
    async () => {
      onStatus('Thử mở khung soạn thảo qua nút "Ảnh/video"...');
      const photoBtn = await page.evaluateHandle(() => {
        const photoKeywords = ['ảnh/video', 'photo/video'];
        const buttons = Array.from(document.querySelectorAll('div[role="button"], div.x1i10hfl, span[role="button"]'));
        for (const btn of buttons) {
          if (btn.closest('a[href]') || btn.closest('[role="banner"], [role="navigation"]')) continue;
          const style = window.getComputedStyle(btn);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          const rect = btn.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 15) continue;

          const text = (btn.innerText || '').toLowerCase().trim();
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase().trim();
          if (photoKeywords.some(kw => text === kw || text.includes(kw) || aria.includes(kw))) {
            return btn;
          }
        }
        return null;
      });

      const el = photoBtn.asElement();
      if (!el) throw new Error('Không tìm thấy nút Ảnh/video');
      await safeClick(page, el);
    },

    // Chiến lược 3: Tìm nút aria-label "Tạo bài viết" hoặc "Create post"
    async () => {
      onStatus('Thử tìm nút Tạo bài viết qua thuộc tính aria...');
      const ariaBtn = await page.evaluateHandle(() => {
        const candidates = Array.from(document.querySelectorAll('div[aria-label="Tạo bài viết"], div[aria-label="Create post"], div[aria-label="Create Post"]'));
        for (const direct of candidates) {
          if (direct.closest('a[href]') || direct.closest('[role="banner"], [role="navigation"]')) continue;
          const rect = direct.getBoundingClientRect();
          if (rect.width > 20 && rect.height > 15) return direct;
        }
        return null;
      });
      const el = ariaBtn.asElement();
      if (!el) throw new Error('Không tìm thấy nút qua aria-label');
      await safeClick(page, el);
    },

    // Chiến lược 4: Thử phím tắt P
    async () => {
      onStatus(t('backend.status.shortcut_p_attempt'));
      await tryOpenComposerByShortcut(page);
    },
  ];

  for (const strategy of strategies) {
    try {
      await strategy();
      await delay(1200);
      return await waitForComposerEditor(page, stepTimeoutMs);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to open create post composer.');
}

module.exports = {
  waitForComposerEditor,
  tryOpenComposerByShortcut,
  openComposer,
};
