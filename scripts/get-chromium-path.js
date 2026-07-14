const path = require('path');
const fs = require('fs');
const os = require('os');

function findChromiumBuildPath() {
  const cacheDir = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');

  if (!fs.existsSync(cacheDir)) {
    throw new Error(`Không tìm thấy puppeteer cache tại: ${cacheDir}`);
  }

  // Lấy version mới nhất tự động
  const versions = fs.readdirSync(cacheDir)
    .filter(f => f.startsWith('win64-'))
    .sort()
    .reverse(); // version mới nhất lên đầu

  if (versions.length === 0) {
    throw new Error('Không tìm thấy Chromium nào trong cache puppeteer');
  }

  const latest = versions[0];
  
  // Thử cả chrome-win64 và chrome-win
  const possibleDirs = ['chrome-win64', 'chrome-win'];
  for (const dir of possibleDirs) {
    const fullPath = path.join(cacheDir, latest, dir);
    if (fs.existsSync(fullPath)) {
      console.log(`✅ Chromium found: ${fullPath}`);
      return fullPath;
    }
  }

  throw new Error(`Không tìm thấy thư mục chrome trong: ${path.join(cacheDir, latest)}`);
}

module.exports = findChromiumBuildPath;

// Chạy trực tiếp để test
if (require.main === module) {
  try {
    console.log(findChromiumBuildPath());
  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}
