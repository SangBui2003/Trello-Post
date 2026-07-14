const { t } = require('../../utils/i18n');
const { delay, normalizeText } = require('../utils/helpers');
const { safeClick, moveCaretToComposerEnd } = require('../utils/dom');

async function typeMultiline(page, content) {
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]) {
      await page.keyboard.type(lines[index], { delay: 24 });
    }

    if (index < lines.length - 1) {
      await page.keyboard.press('Enter');
      await delay(40);
    }
  }
}

async function verifyComposerContent(composer, expectedContent) {
  const actualContent = await composer.evaluate((element) => {
    return (element.innerText || element.textContent || '').replace(/\u00a0/g, ' ').trim();
  });

  const normalizedActual = normalizeText(actualContent);
  const normalizedExpected = normalizeText(expectedContent);
  const sample = normalizedExpected.slice(0, Math.min(32, normalizedExpected.length));

  return sample ? normalizedActual.includes(sample) : false;
}

async function fillComposer(page, composer, content) {
  await safeClick(page, composer);
  await delay(250);
  await moveCaretToComposerEnd(composer);

  // Instantly paste content instead of typing character by character
  await composer.evaluate((element, text) => {
    element.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    document.execCommand('delete', false);

    const inserted = document.execCommand('insertText', false, text);

    if (!inserted) {
      element.textContent = text;
      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: 'insertText',
        })
      );
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, content);

  if (!(await verifyComposerContent(composer, content))) {
    throw new Error(t('backend.errors.composer_failed'));
  }
}

module.exports = {
  typeMultiline,
  verifyComposerContent,
  fillComposer,
};
