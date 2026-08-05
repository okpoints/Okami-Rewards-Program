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
// token the driver typed appears somewhere in their full Cortex name or in
// an alias a manager added. Aliases add to the pool of recognized tokens
// rather than needing to stand alone as a complete name - "Alex" as an
// alias plus "Martinez" from the Cortex name together match "Alex Martinez".
function findCandidates(enteredName, rosterEntries) {
  const enteredTokens = tokenize(enteredName);
  if (enteredTokens.length === 0) return [];

  return rosterEntries.filter((entry) => {
    const nameVariants = [entry.cortexFullName, ...(entry.aliases || [])];
    const knownTokens = new Set(nameVariants.flatMap(tokenize));
    return enteredTokens.every((token) => knownTokens.has(token));
  });
}

// Used to catch spelling drift in the weekly Cortex export (e.g. a middle
// initial that appears one week and not the next) - unlike findCandidates
// above, drift can go either direction, so a roster entry counts as a
// candidate if ITS tokens are a subset of the new name's, or vice versa.
function findDriftCandidates(rawName, rosterEntries) {
  const nameTokens = new Set(tokenize(rawName));
  if (nameTokens.size === 0) return [];

  return rosterEntries.filter((entry) => {
    const nameVariants = [entry.cortexFullName, ...(entry.aliases || [])];
    const knownTokens = new Set(nameVariants.flatMap(tokenize));
    if (knownTokens.size === 0) return false;
    const knownIsSubset = [...knownTokens].every((token) => nameTokens.has(token));
    const enteredIsSubset = [...nameTokens].every((token) => knownTokens.has(token));
    return knownIsSubset || enteredIsSubset;
  });
}

module.exports = { normalizeName, tokenize, findCandidates, findDriftCandidates };
