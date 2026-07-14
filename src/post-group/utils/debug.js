const fs = require('fs');
const path = require('path');

async function saveDebugScreenshot(page, sessionDir) {
  try {
    await fs.promises.mkdir(sessionDir, { recursive: true });
    const screenshotPath = path.join(sessionDir, 'last-facebook-error.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } catch (error) {
    return null;
  }
}

module.exports = {
  saveDebugScreenshot,
};
