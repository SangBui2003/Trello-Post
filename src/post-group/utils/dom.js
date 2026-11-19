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
      behavior: 'instant',
    });
  }).catch(() => {});

  await delay(250);

  try {
    await element.click({ delay: 50 });
    await delay(600);
    return;
  } catch (error) {
    try {
      const box = await element.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { delay: 30 });
        await delay(600);
        return;
      }
    } catch (innerError) {}

    try {
      await element.evaluate((node) => {
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      await delay(600);
      return;
    } catch (evalError) {
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
