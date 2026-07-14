const fs = require('fs');
const path = require('path');

const { app } = require('electron');

let currentLang = 'vi';
let locales = {};

function loadLocales() {
  try {
    const rootPath = app ? app.getAppPath() : path.join(__dirname, '../../');
    const enPath = path.join(rootPath, 'renderer/src/locales/en/translation.json');
    const viPath = path.join(rootPath, 'renderer/src/locales/vi/translation.json');
    
    if (fs.existsSync(enPath)) {
      locales.en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
    }
    if (fs.existsSync(viPath)) {
      locales.vi = JSON.parse(fs.readFileSync(viPath, 'utf8'));
    }
  } catch (error) {
    console.error('Failed to load locale files in backend:', error);
  }
}

// Initial load
loadLocales();

function setLanguage(lang) {
  if (locales[lang]) {
    currentLang = lang;
  }
}

function t(key, params = {}) {
  const keys = key.split('.');
  let value = locales[currentLang];
  
  for (const k of keys) {
    if (value && value[k]) {
      value = value[k];
    } else {
      return key; 
    }
  }
  
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([_a-zA-Z0-9]+)\s*\}\}/g, (match, p1) => {
      return params[p1] !== undefined ? params[p1] : match;
    });
  }
  
  return key;
}

module.exports = { setLanguage, t };
