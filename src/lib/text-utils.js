function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFileName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.json$/i, "")
    .replace(/[\s\-_]+/g, "")
    .trim();
}

function isLikelyAsciiEnglish(text) {
  const value = normalizeText(text);

  if (!value) {
    return false;
  }

  return /^[\x00-\x7F\s.,!?\'"()\-:;\/\\[\]{}@#$%^&*+=_|<>~`0-9]+$/.test(
    value,
  );
}

function extractPlaceholders(text) {
  return (String(text || "").match(/\{[^}]+\}/g) || []).sort();
}

function placeholdersMatch(sourceText, translatedText) {
  const source = extractPlaceholders(sourceText);
  const translated = extractPlaceholders(translatedText);
  return JSON.stringify(source) === JSON.stringify(translated);
}

module.exports = {
  isLikelyAsciiEnglish,
  normalizeFileName,
  normalizeText,
  placeholdersMatch,
};
