const fs = require("fs-extra");
const path = require("path");
const xlsx = require("xlsx");

// ---------------- CONFIG ----------------
const FRONTEND_BASE = path.join(__dirname, "i18n_frontend");
const EXCEL_PATH = path.join(
  __dirname,
  "001. Translated_iReport_Ethiopia_Interface_final Edited.xlsx",
);
const SHEET_NAME = "FrontEnd";

const REPORT_PATH = path.join(__dirname, "frontend_translation_report.json");

// If true, missing translations fall back to English text in am.json
// If false, missing translations become empty strings
const FALLBACK_TO_ENGLISH = true;

// If duplicate key rows have different translations,
// choose "last" or "first"
const DUPLICATE_CONFLICT_STRATEGY = "last";
// ----------------------------------------

// ---------- Helpers ----------

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function getLeafType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function flattenObject(obj, prefix = "", result = {}) {
  if (!isObject(obj)) return result;

  for (const [key, value] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (isObject(value)) {
      flattenObject(value, nextKey, result);
    } else {
      result[nextKey] = value;
    }
  }

  return result;
}

function setNested(obj, keyPath, value) {
  const parts = keyPath.split(".");
  let current = obj;

  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;

    if (isLast) {
      current[part] = value;
    } else {
      if (!isObject(current[part])) {
        current[part] = {};
      }
      current = current[part];
    }
  });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function safeReadJson(filePath) {
  try {
    return fs.readJsonSync(filePath);
  } catch (err) {
    console.warn(`⚠️ Failed to read JSON: ${filePath}`);
    return null;
  }
}

function findFrontendModules(baseDir) {
  if (!fs.existsSync(baseDir)) return [];

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const modules = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const moduleName = entry.name;
    const enPath = path.join(baseDir, moduleName, "en.json");

    if (fs.existsSync(enPath)) {
      modules.push({
        moduleName,
        dir: path.join(baseDir, moduleName),
        enPath,
      });
    }
  }

  return modules;
}

function buildEnglishIndexes(flatEn) {
  const byKey = new Map();
  const byEnglish = new Map();

  for (const [key, value] of Object.entries(flatEn)) {
    byKey.set(key, value);

    const normalized = normalizeText(value);
    if (!normalized) continue;

    if (!byEnglish.has(normalized)) byEnglish.set(normalized, []);
    byEnglish.get(normalized).push(key);
  }

  return { byKey, byEnglish };
}

function carryForwardRows(rows) {
  const carried = [];
  let currentFileName = "";

  for (const rawRow of rows) {
    const fileNameCell = String(rawRow["Translation File Name"] || "").trim();
    const key = String(rawRow["Key"] || "").trim();
    const english = normalizeText(rawRow["Corrected English Translation"]);
    const amharic = normalizeText(rawRow["Amharic Translation"]);

    if (fileNameCell) {
      currentFileName = fileNameCell;
    }

    // skip completely empty rows
    if (!currentFileName && !key && !english && !amharic) continue;

    carried.push({
      fileName: currentFileName,
      key,
      english,
      amharic,
      original: rawRow,
    });
  }

  return carried;
}

// Build translation candidates from Excel for one module.
// We index them in 2 ways:
// 1. exact key
// 2. English text
function buildTranslationCandidates(rowsForModule) {
  const byKey = new Map();
  const byEnglish = new Map();

  const duplicateConflicts = [];
  const ignoredRows = [];

  for (const row of rowsForModule) {
    if (!row.fileName) {
      ignoredRows.push({ reason: "missing_file_name", row });
      continue;
    }

    if (!row.amharic) {
      ignoredRows.push({ reason: "missing_amharic", row });
      continue;
    }

    // index by key
    if (row.key) {
      if (byKey.has(row.key)) {
        const prev = byKey.get(row.key);
        if (prev !== row.amharic) {
          duplicateConflicts.push({
            type: "duplicate_key_conflict",
            key: row.key,
            previous: prev,
            incoming: row.amharic,
          });

          if (DUPLICATE_CONFLICT_STRATEGY === "last") {
            byKey.set(row.key, row.amharic);
          }
        }
      } else {
        byKey.set(row.key, row.amharic);
      }
    }

    // index by English text
    if (row.english) {
      if (!byEnglish.has(row.english)) {
        byEnglish.set(row.english, new Set());
      }
      byEnglish.get(row.english).add(row.amharic);
    }
  }

  // convert byEnglish set -> chosen translation
  const resolvedByEnglish = new Map();
  for (const [english, translationsSet] of byEnglish.entries()) {
    const translations = Array.from(translationsSet);

    if (translations.length === 1) {
      resolvedByEnglish.set(english, translations[0]);
    } else {
      // conflicting translations for same English text
      duplicateConflicts.push({
        type: "duplicate_english_conflict",
        english,
        translations,
      });

      resolvedByEnglish.set(
        english,
        DUPLICATE_CONFLICT_STRATEGY === "last"
          ? translations[translations.length - 1]
          : translations[0],
      );
    }
  }

  return {
    byKey,
    byEnglish: resolvedByEnglish,
    duplicateConflicts,
    ignoredRows,
  };
}

function buildAmJsonFromEn(enJson, flatEn, candidates, report, moduleName) {
  const amJson = deepClone(enJson);

  for (const [key, enValue] of Object.entries(flatEn)) {
    const valueType = getLeafType(enValue);

    // Only translate string leaves.
    if (valueType !== "string") {
      report.nonStringLeaves.push({
        moduleName,
        key,
        type: valueType,
      });
      continue;
    }

    const normalizedEnglish = normalizeText(enValue);

    let translated = null;
    let matchType = null;

    // Priority 1: direct key match
    if (candidates.byKey.has(key)) {
      translated = candidates.byKey.get(key);
      matchType = "key";
    }
    // Priority 2: English value match
    else if (normalizedEnglish && candidates.byEnglish.has(normalizedEnglish)) {
      translated = candidates.byEnglish.get(normalizedEnglish);
      matchType = "english";
    }

    if (translated && normalizeText(translated)) {
      setNested(amJson, key, translated);
      report.matched.push({
        moduleName,
        key,
        matchType,
        en: enValue,
        am: translated,
      });
    } else {
      const fallbackValue = FALLBACK_TO_ENGLISH ? enValue : "";
      setNested(amJson, key, fallbackValue);

      report.missing.push({
        moduleName,
        key,
        en: enValue,
      });
    }
  }

  return amJson;
}

// ---------- Main ----------

(function main() {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`❌ Excel file not found: ${EXCEL_PATH}`);
    process.exit(1);
  }

  if (!fs.existsSync(FRONTEND_BASE)) {
    console.error(`❌ Frontend base folder not found: ${FRONTEND_BASE}`);
    process.exit(1);
  }

  const workbook = xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets[SHEET_NAME];

  if (!sheet) {
    console.error(`❌ Sheet "${SHEET_NAME}" not found in workbook`);
    process.exit(1);
  }

  const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const rows = carryForwardRows(rawRows);

  const modules = findFrontendModules(FRONTEND_BASE);

  if (!modules.length) {
    console.error(
      `❌ No frontend modules with en.json found under: ${FRONTEND_BASE}`,
    );
    process.exit(1);
  }

  const rowsByModule = new Map();
  for (const row of rows) {
    if (!row.fileName) continue;
    if (!rowsByModule.has(row.fileName)) rowsByModule.set(row.fileName, []);
    rowsByModule.get(row.fileName).push(row);
  }

  const report = {
    createdAt: new Date().toISOString(),
    config: {
      FRONTEND_BASE,
      EXCEL_PATH,
      SHEET_NAME,
      FALLBACK_TO_ENGLISH,
      DUPLICATE_CONFLICT_STRATEGY,
    },
    summary: {
      modulesFound: modules.length,
      modulesProcessed: 0,
      modulesMissingInExcel: [],
      excelModulesMissingInFrontend: [],
      matchedCount: 0,
      missingCount: 0,
      duplicateConflictCount: 0,
      ignoredRowCount: 0,
      nonStringLeafCount: 0,
    },
    matched: [],
    missing: [],
    duplicateConflicts: [],
    ignoredRows: [],
    nonStringLeaves: [],
  };

  const frontendModuleNames = new Set(modules.map((m) => m.moduleName));
  const excelModuleNames = new Set(rows.map((r) => r.fileName).filter(Boolean));

  for (const excelModule of excelModuleNames) {
    if (!frontendModuleNames.has(excelModule)) {
      report.summary.excelModulesMissingInFrontend.push(excelModule);
    }
  }

  for (const moduleInfo of modules) {
    const { moduleName, dir, enPath } = moduleInfo;

    const enJson = safeReadJson(enPath);
    if (!enJson) continue;

    const flatEn = flattenObject(enJson);
    const moduleRows = rowsByModule.get(moduleName) || [];

    if (!moduleRows.length) {
      report.summary.modulesMissingInExcel.push(moduleName);
    }

    const candidates = buildTranslationCandidates(moduleRows);

    report.duplicateConflicts.push(
      ...candidates.duplicateConflicts.map((x) => ({
        moduleName,
        ...x,
      })),
    );
    report.ignoredRows.push(
      ...candidates.ignoredRows.map((x) => ({
        moduleName,
        ...x,
      })),
    );

    const amJson = buildAmJsonFromEn(
      enJson,
      flatEn,
      candidates,
      report,
      moduleName,
    );

    const amPath = path.join(dir, "am.json");
    fs.writeJsonSync(amPath, amJson, { spaces: 2 });
    console.log(`✅ Created/updated: ${amPath}`);

    report.summary.modulesProcessed += 1;
  }

  report.summary.matchedCount = report.matched.length;
  report.summary.missingCount = report.missing.length;
  report.summary.duplicateConflictCount = report.duplicateConflicts.length;
  report.summary.ignoredRowCount = report.ignoredRows.length;
  report.summary.nonStringLeafCount = report.nonStringLeaves.length;

  fs.writeJsonSync(REPORT_PATH, report, { spaces: 2 });
  console.log(`\n📝 Report written to: ${REPORT_PATH}`);
  console.log("\n🎉 Frontend Amharic translation generation complete.");
})();
