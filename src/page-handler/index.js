const PageScanner = require('./PageScanner');
const PageSwitcher = require('./PageSwitcher');
const { joinGroup } = require('./GroupJoiner');

const scanner = new PageScanner();

/**
 * Quét danh sách Fanpage của 1 tài khoản Facebook.
 * @param {string} cookieString
 * @returns {Promise<Array<{pageName: string, pageUrl: string}>>}
 */
async function scanPages(cookieString) {
  return scanner.scanPages(cookieString);
}

module.exports = {
  PageScanner,
  PageSwitcher,
  scanPages,
  joinGroup,
};
