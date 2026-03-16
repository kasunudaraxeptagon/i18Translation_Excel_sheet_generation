const fs = require("fs-extra");
const path = require("path");
const xlsx = require("xlsx");

// --- CONFIG: adjust paths if needed ---
const FRONTEND_BASE = path.join(__dirname, "i18n_frontend");
const BACKEND_ES_DIR = path.join(__dirname, "i18n_backend", "es");
const EXCEL_PATH = path.join(__dirname, "translationsFound.xlsx");

// --- Helpers ---

// Set nested value from "a.b.c" path
function setNested(obj, keyPath, value) {
  const parts = keyPath.split(".");
  let current = obj;

  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;

    if (isLast) {
      current[part] = value;
    } else {
      if (
        current[part] === undefined ||
        current[part] === null ||
        typeof current[part] !== "object" ||
        Array.isArray(current[part])
      ) {
        current[part] = {};
      }
      current = current[part];
    }
  });
}

// Group rows by "Translation File Name" into nested ES objects per file
function buildFileMap(rows) {
  const fileMap = {}; // { fileName: { ...esJson } }

  for (const row of rows) {
    const fileName = String(row["Translation File Name"] || "").trim();
    const key = String(row["Key"] || "").trim();
    const esRaw = row["Spanish Translation"];

    const es =
      esRaw === undefined || esRaw === null ? "" : String(esRaw).trim();

    // Skip invalid/incomplete rows
    if (!fileName || !key || !es) continue;

    if (!fileMap[fileName]) fileMap[fileName] = {};
    setNested(fileMap[fileName], key, es);
  }

  return fileMap;
}

function processSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return;

  const lowerName = sheetName.toLowerCase();
  const isFrontendSheet = lowerName.includes("front");
  const isBackendSheet = lowerName.includes("back");

  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const fileMap = buildFileMap(rows);

  Object.entries(fileMap).forEach(([fileName, esObj]) => {
    if (isFrontendSheet) {
      // i18n_frontend/<fileName>/es.json
      const moduleDir = path.join(FRONTEND_BASE, fileName);
      const esPath = path.join(moduleDir, "es.json");
      fs.ensureDirSync(moduleDir);
      fs.writeJsonSync(esPath, esObj, { spaces: 2 });
      console.log(`✅ Frontend: created/updated ${esPath}`);
    } else if (isBackendSheet) {
      // i18n_backend/es/<fileName>.json
      fs.ensureDirSync(BACKEND_ES_DIR);
      const esPath = path.join(BACKEND_ES_DIR, `${fileName}.json`);
      fs.writeJsonSync(esPath, esObj, { spaces: 2 });
      console.log(`✅ Backend: created/updated ${esPath}`);
    } else {
      // Fallback: if sheet name doesn't clearly say frontend/backend
      const outDir = path.join(__dirname, "output_es", sheetName);
      fs.ensureDirSync(outDir);
      const esPath = path.join(outDir, `${fileName}.json`);
      fs.writeJsonSync(esPath, esObj, { spaces: 2 });
      console.log(`ℹ️  Unknown sheet type; wrote ${esPath}`);
    }
  });
}

// --- Run ---

(function main() {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`❌ Excel file not found at: ${EXCEL_PATH}`);
    process.exit(1);
  }

  const workbook = xlsx.readFile(EXCEL_PATH);

  workbook.SheetNames.forEach((sheetName) => {
    console.log(`\n▶ Processing sheet: ${sheetName}`);
    processSheet(workbook, sheetName);
  });

  console.log("\n🎉 Done generating es.json files from translationsFound.xlsx");
})();
