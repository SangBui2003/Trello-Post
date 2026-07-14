const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeText(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  delay,
  normalizeText,
};
