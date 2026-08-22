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

        const exactMatch = document.querySelector('[role="dialog"] div[role="textbox"][contenteditable="true"]');
        if (exactMatch && isVisibleElement(exactMatch)) {
            return exactMatch;
        }

        const candidates = Array.from(
          document.querySelectorAll(
            '[role="dialog"] [contenteditable="true"], [role="dialog"] [role="textbox"], [contenteditable="true"][role="textbox"], div[contenteditable="true"]'
          )
        );

        let bestElement = null;
        let bestScore = -Infinity;

        for (const element of candidates) {
          if (!isVisibleElement(element)) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          let score = 0;

          if (element.closest('[role="dialog"]')) {
            score += 100;
          }

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
    async () => {
      onStatus(t('backend.status.searching_composer_btn'));
      const startedAt = Date.now();
      let el = null;
      
      while (Date.now() - startedAt < 10000) {
        const createPostButton = await page.evaluateHandle(() => {
          const texts = ['viết gì', 'write something', 'tạo bài viết', 'nghĩ gì', 'mind', 'bạn đang nghĩ gì'];
          const elements = Array.from(document.querySelectorAll('span, div[role="button"], div.x1i10hfl, div[style*="cursor: pointer"]'));
          
          for (const el of elements) {
            const text = (el.innerText || '').toLowerCase();
            if (text.length > 0 && text.length < 50) {
              if (texts.some((t) => text.includes(t))) {
                return el;
              }
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
