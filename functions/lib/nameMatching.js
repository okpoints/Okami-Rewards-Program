// The weekly Cortex export sometimes appends a generational suffix
// ("Jr", "II", ...) inconsistently, so we strip those before comparing.
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

function tokenize(rawName) {
  return (rawName || '')
    .toLowerCase()
    .replace(/[.,]/g, '')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !SUFFIXES.has(token));
}

function normalizeName(rawName) {
  return tokenize(rawName).join(' ').trim();
}

// Cortex has full legal names (first/middle/last/second-last), but a driver
// usually signs up with a shortened version - e.g. "Edgar Gonzales" for
// "Edgar Rafael Morales Gonzales". A roster entry is a candidate if every
// token the driver typed appears somewhere in their full Cortex name.
function findCandidates(enteredName, rosterEntries) {
  const enteredTokens = tokenize(enteredName);
  if (enteredTokens.length === 0) return [];

  return rosterEntries.filter((entry) => {
    const rosterTokens = new Set(tokenize(entry.cortexFullName));
    return enteredTokens.every((token) => rosterTokens.has(token));
  });
}

module.exports = { normalizeName, tokenize, findCandidates };
