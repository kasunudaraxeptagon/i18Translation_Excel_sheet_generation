const fs = require("fs-extra");
const path = require("path");
const xlsx = require("xlsx");

// ROOT: i18n_frontend
const BASE_DIR = path.join(__dirname, "i18n_frontend");
const rows = [
  [
    "Translation File Name",
    "Key",
    "English Translation",
    "Amharic Translation",
  ],
];

// Flatten nested JSON keys
function flatten(obj, prefix = "") {
  let out = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out = { ...out, ...flatten(value, fullKey) };
    } else {
      out[fullKey] = value;
    }
  }
  return out;
}

// Read each module directory in i18n_frontend
fs.readdirSync(BASE_DIR, { withFileTypes: true }).forEach((entry) => {
  if (!entry.isDirectory()) return;

  const translationDir = path.join(BASE_DIR, entry.name);
  const enFile = path.join(translationDir, "en.json");
  const esFile = path.join(translationDir, "es.json");

  if (!fs.existsSync(enFile)) return;

  const enData = fs.readJsonSync(enFile);
  const enFlat = flatten(enData);

  let esFlat = {};
  if (fs.existsSync(esFile)) {
    const esData = fs.readJsonSync(esFile);
    esFlat = flatten(esData);
  }

  for (const [key, enValue] of Object.entries(enFlat)) {
    const esValue = esFlat[key];

    // Only add row if Spanish is missing or empty
    if (esValue === undefined || esValue === null || esValue === "") {
      rows.push([entry.name, key, enValue, ""]);
    }
  }

  rows.push([]); // empty row after each module
});

// Write to Excel
const worksheet = xlsx.utils.aoa_to_sheet(rows);
const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, worksheet, "Translations");
xlsx.writeFile(workbook, "frontend_missing_es.xlsx");

console.log(
  "✅ Created frontend_missing_es.xlsx with ONLY keys missing in es.json.",
);
