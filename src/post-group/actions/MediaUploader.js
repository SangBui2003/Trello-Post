const { t } = require('../../utils/i18n');
const path = require('path');
const { delay } = require('../utils/helpers');
const { safeClick } = require('../utils/dom');

async function waitForFileInput(page, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const handle = await page.evaluateHandle(() => {
        const candidates = Array.from(document.querySelectorAll('input[type="file"]'));

        const valid = candidates.filter((element) => {
          const accept = (element.getAttribute('accept') || '').toLowerCase();
          return accept.includes('image') || accept.includes('video') || !accept;
        });
        
        return valid.length > 0 ? valid[valid.length - 1] : null;
      });

      const element = handle.asElement();
      if (element) {
        return element;
      }

      await handle.dispose();
    } catch (error) {
      // Retry on transient rerender.
    }

    await delay(250);
  }

  throw new Error(t('backend.errors.file_input'));
}

async function resolveImageFileInput(page, timeoutMs, onStatus, imagePath) {
  onStatus(t('backend.status.opening_photo_action'));
  let fileChooser = null;

  try {
    const explicitBtn = await page.evaluateHandle(() => {
      const dialog = document.querySelector('[role="dialog"]') || document;
      const elements = Array.from(dialog.querySelectorAll('[aria-label], [data-tooltip-content], img[alt]'));
      
      for (const el of elements) {
        const label = (el.getAttribute('aria-label') || el.getAttribute('data-tooltip-content') || el.getAttribute('alt') || '').toLowerCase();
        if (label.includes('ảnh/video') || label.includes('photo/video') || label === 'ảnh' || label === 'photo' || label === 'video') {
          return el.closest('div[role="button"]') || el.closest('span[role="button"]') || el;
        }
      }
      return null;
    });

    const targetButton = explicitBtn.asElement();

    if (targetButton) {
      const [fc] = await Promise.all([
        page.waitForFileChooser({ timeout: 4000 }).catch(() => null),
        safeClick(page, targetButton)
      ]);
      fileChooser = fc;
    }
  } catch (error) {
    // Fail gracefully
  }

  if (fileChooser && imagePath) {
    onStatus(t('backend.status.uploading_file_chooser'));
    await fileChooser.accept([path.resolve(imagePath)]);
    return null; // Tương đương đã upload thành công
  }
  
  await delay(1200);

  onStatus(t('backend.status.uploading_fallback'));
  return waitForFileInput(page, timeoutMs);
}

module.exports = {
  waitForFileInput,
  resolveImageFileInput,
};
