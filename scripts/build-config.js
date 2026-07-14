const fs = require('fs');
const findChromiumBuildPath = require('./get-chromium-path');

try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  // Tự động detect chromium path
  const chromiumFrom = findChromiumBuildPath();

  // Cập nhật extraResources
  pkg.build.extraResources = [
    {
      from: chromiumFrom.replace(/\\/g, '/'),
      to: 'chromium',
      filter: ['**/*']
    }
  ];

  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
  console.log(`✅ package.json updated with chromium: ${chromiumFrom}`);
} catch (err) {
  console.error(`❌ Error updating package.json: ${err.message}`);
  process.exit(1);
}
