const { delay } = require('./helpers');

async function isVisible(handle) {
  try {
    const box = await handle.boundingBox();
    if (!box || box.width === 0 || box.height === 0) {
      return false;
    }

    return await handle.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none';
    });
  } catch (error) {
    return false;
  }
}

async function focusDocument(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    if (document.body instanceof HTMLElement) {
      document.body.focus();
    }
  });
}

async function safeClick(page, element) {
  await element.evaluate((node) => {
    node.scrollIntoView({
      block: 'center',
      inline: 'center',
      behavior: 'auto',
    });
  });

  await delay(200);

  try {
    await element.click({ delay: 45 });
    await delay(600);
    return;
  } catch (error) {
    try {
      await element.evaluate((node) => node.click());
      await delay(600);
      return;
    } catch (innerError) {
      const box = await element.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 25 });
        return;
      }
      throw error;
    }
  }
}

async function moveCaretToComposerEnd(composer) {
  await composer.evaluate((element) => {
    element.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function waitForPageSettled(page) {
  await delay(1000);
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 5000 }).catch(() => {});
}

module.exports = {
  isVisible,
  focusDocument,
  safeClick,
  moveCaretToComposerEnd,
  waitForPageSettled,
};
