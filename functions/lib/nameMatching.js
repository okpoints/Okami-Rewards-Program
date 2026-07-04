// The weekly Cortex export sometimes appends a generational suffix
// ("Jr", "II", ...) inconsistently, so we strip those before comparing.
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function normalizeName(rawName) {
  return (rawName || '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !SUFFIXES.has(token))
    .join(' ')
    .trim();
}

module.exports = { normalizeName };
