const fs = require("fs-extra");
const path = require("path");
const xlsx = require("xlsx");

// i18n_backend/en and i18n_backend/es
const EN_DIR = path.join(__dirname, "i18n_backend", "en");
const ES_DIR = path.join(__dirname, "i18n_backend", "am");

const rows = [
  [
    "Translation File Name",
    "Key",
    "English Translation",
    "Amharic Translation",
  ],
];

// Flatten nested keys
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

// Read all .json files in ./i18n_backend/en
fs.readdirSync(EN_DIR).forEach((file) => {
  if (!file.endsWith(".json")) return;

  const enPath = path.join(EN_DIR, file);
  const esPath = path.join(ES_DIR, file); // same filename in es
  const fileNameWithoutExt = path.basename(file, ".json");

  const enData = fs.readJsonSync(enPath);
  const enFlat = flatten(enData);

  let esFlat = {};
  if (fs.existsSync(esPath)) {
    const esData = fs.readJsonSync(esPath);
    esFlat = flatten(esData);
  }

  for (const [key, enValue] of Object.entries(enFlat)) {
    const esValue = esFlat[key];

    // Only add if Spanish key is missing or empty
    if (esValue === undefined || esValue === null || esValue === "") {
      rows.push([fileNameWithoutExt, key, enValue, ""]);
    }
  }

  rows.push([]); // empty row after each file
});

// Write to backend_missing_es.xlsx
const worksheet = xlsx.utils.aoa_to_sheet(rows);
const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, worksheet, "Backend Translations");
xlsx.writeFile(workbook, "backend_missing_es.xlsx");

console.log(
  "✅ Created backend_missing_es.xlsx with ONLY keys missing in es/*.json.",
);
