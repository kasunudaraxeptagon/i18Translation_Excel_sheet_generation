const fs = require("fs-extra");
const path = require("path");
const xlsx = require("xlsx");

// ---------------- CONFIG ----------------
const BACKEND_BASE = path.join(__dirname, "i18n_backend");
const EN_DIR = path.join(BACKEND_BASE, "en");
const AM_DIR = path.join(BACKEND_BASE, "am");

const EXCEL_PATH = path.join(
  __dirname,
  "001. Translated_iReport_Ethiopia_Interface_final Edited.xlsx",
);

const SHEET_NAME = "BackEnd";
const REPORT_PATH = path.join(__dirname, "backend_translation_report.json");

// If true, missing translations fall back to English text in am json
const FALLBACK_TO_ENGLISH = true;

// If duplicate rows conflict, choose "last" or "first"
const DUPLICATE_CONFLICT_STRATEGY = "last";

// If true, rows whose translated text still looks English are ignored
const IGNORE_LIKELY_ENGLISH_TRANSLATIONS = true;
// ----------------------------------------

// ---------- Helpers ----------

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
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

function normalizeFileName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.json$/i, "")
    .replace(/[\s\-_]+/g, "")
    .trim();
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

function getLeafType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function safeReadJson(filePath) {
  try {
    return fs.readJsonSync(filePath);
  } catch (err) {
    console.warn(`⚠️ Failed to read JSON: ${filePath}`);
    return null;
  }
}

function getBackendEnglishFiles(enDir) {
  if (!fs.existsSync(enDir)) return [];

  const entries = fs.readdirSync(enDir, { withFileTypes: true });

  return entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"),
    )
    .map((entry) => {
      const fileName = entry.name.replace(/\.json$/i, "");
      return {
        fileName,
        normalizedFileName: normalizeFileName(fileName),
        enPath: path.join(enDir, entry.name),
      };
    });
}

// Carry forward file name if client sheet only mentions it once per block
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

    if (!currentFileName && !key && !english && !amharic) continue;

    carried.push({
      fileName: currentFileName,
      normalizedFileName: normalizeFileName(currentFileName),
      key,
      english,
      amharic,
      original: rawRow,
    });
  }

  return carried;
}

function isLikelyEnglish(text) {
  const value = normalizeText(text);
  if (!value) return false;

  // pure ASCII-ish text usually means untranslated English leftovers
  return /^[\x00-\x7F\s.,!?'"()\-:;\/\\[\]{}@#$%^&*+=_|<>~`0-9]+$/.test(value);
}

function extractPlaceholders(text) {
  return (String(text || "").match(/\{[^}]+\}/g) || []).sort();
}

function placeholdersMatch(en, translated) {
  const enP = extractPlaceholders(en);
  const trP = extractPlaceholders(translated);
  return JSON.stringify(enP) === JSON.stringify(trP);
}

function buildTranslationCandidates(rowsForFile) {
  const byKey = new Map();
  const byEnglish = new Map();

  const duplicateConflicts = [];
  const ignoredRows = [];

  for (const row of rowsForFile) {
    if (!row.fileName) {
      ignoredRows.push({ reason: "missing_file_name", row });
      continue;
    }

    if (!row.amharic) {
      ignoredRows.push({ reason: "missing_amharic", row });
      continue;
    }

    if (IGNORE_LIKELY_ENGLISH_TRANSLATIONS && isLikelyEnglish(row.amharic)) {
      ignoredRows.push({ reason: "likely_english_translation", row });
      continue;
    }

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

    if (row.english) {
      if (!byEnglish.has(row.english)) {
        byEnglish.set(row.english, new Set());
      }
      byEnglish.get(row.english).add(row.amharic);
    }
  }

  const resolvedByEnglish = new Map();

  for (const [english, translationsSet] of byEnglish.entries()) {
    const translations = Array.from(translationsSet);

    if (translations.length === 1) {
      resolvedByEnglish.set(english, translations[0]);
    } else {
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

function buildAmJsonFromEn(enJson, flatEn, candidates, report, fileName) {
  const amJson = deepClone(enJson);

  for (const [key, enValue] of Object.entries(flatEn)) {
    const valueType = getLeafType(enValue);

    // Only string leaves are translatable
    if (valueType !== "string") {
      report.nonStringLeaves.push({
        fileName,
        key,
        type: valueType,
      });
      continue;
    }

    const normalizedEnglish = normalizeText(enValue);

    let translated = null;
    let matchType = null;

    if (candidates.byKey.has(key)) {
      translated = candidates.byKey.get(key);
      matchType = "key";
    } else if (
      normalizedEnglish &&
      candidates.byEnglish.has(normalizedEnglish)
    ) {
      translated = candidates.byEnglish.get(normalizedEnglish);
      matchType = "english";
    }

    if (translated && normalizeText(translated)) {
      if (!placeholdersMatch(enValue, translated)) {
        report.placeholderMismatches.push({
          fileName,
          key,
          en: enValue,
          am: translated,
        });
      }

      setNested(amJson, key, translated);
      report.matched.push({
        fileName,
        key,
        matchType,
        en: enValue,
        am: translated,
      });
    } else {
      const fallbackValue = FALLBACK_TO_ENGLISH ? enValue : "";
      setNested(amJson, key, fallbackValue);

      report.missing.push({
        fileName,
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

  if (!fs.existsSync(EN_DIR)) {
    console.error(`❌ Backend English directory not found: ${EN_DIR}`);
    process.exit(1);
  }

  fs.ensureDirSync(AM_DIR);

  const workbook = xlsx.readFile(EXCEL_PATH);
  const sheet = workbook.Sheets[SHEET_NAME];

  if (!sheet) {
    console.error(`❌ Sheet "${SHEET_NAME}" not found in workbook`);
    process.exit(1);
  }

  const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const rows = carryForwardRows(rawRows);

  const backendFiles = getBackendEnglishFiles(EN_DIR);

  if (!backendFiles.length) {
    console.error(`❌ No backend en json files found in: ${EN_DIR}`);
    process.exit(1);
  }

  // Group Excel rows by normalized file name
  const rowsByFile = new Map();
  for (const row of rows) {
    if (!row.normalizedFileName) continue;
    if (!rowsByFile.has(row.normalizedFileName)) {
      rowsByFile.set(row.normalizedFileName, []);
    }
    rowsByFile.get(row.normalizedFileName).push(row);
  }

  const report = {
    createdAt: new Date().toISOString(),
    config: {
      BACKEND_BASE,
      EN_DIR,
      AM_DIR,
      EXCEL_PATH,
      SHEET_NAME,
      FALLBACK_TO_ENGLISH,
      DUPLICATE_CONFLICT_STRATEGY,
      IGNORE_LIKELY_ENGLISH_TRANSLATIONS,
    },
    summary: {
      englishFilesFound: backendFiles.length,
      filesProcessed: 0,
      filesMissingInExcel: [],
      excelFilesMissingInBackend: [],
      matchedCount: 0,
      missingCount: 0,
      duplicateConflictCount: 0,
      ignoredRowCount: 0,
      nonStringLeafCount: 0,
      placeholderMismatchCount: 0,
    },
    matched: [],
    missing: [],
    duplicateConflicts: [],
    ignoredRows: [],
    nonStringLeaves: [],
    placeholderMismatches: [],
  };

  const backendFileMap = new Map();
  for (const file of backendFiles) {
    backendFileMap.set(file.normalizedFileName, file);
  }

  const backendNormalizedNames = new Set(
    backendFiles.map((f) => f.normalizedFileName),
  );
  const excelNormalizedNames = new Set(
    rows.map((r) => r.normalizedFileName).filter(Boolean),
  );

  for (const excelFile of excelNormalizedNames) {
    if (!backendNormalizedNames.has(excelFile)) {
      const sampleRow = rows.find((r) => r.normalizedFileName === excelFile);
      report.summary.excelFilesMissingInBackend.push({
        excelFileName: sampleRow?.fileName || excelFile,
        normalizedFileName: excelFile,
      });
    }
  }

  for (const [, fileInfo] of backendFileMap.entries()) {
    const { fileName, normalizedFileName, enPath } = fileInfo;

    const enJson = safeReadJson(enPath);
    if (!enJson) continue;

    const flatEn = flattenObject(enJson);
    const fileRows = rowsByFile.get(normalizedFileName) || [];

    if (!fileRows.length) {
      report.summary.filesMissingInExcel.push(fileName);
      console.warn(`⚠️ No translations found for backend file: ${fileName}`);
    }

    const candidates = buildTranslationCandidates(fileRows);

    report.duplicateConflicts.push(
      ...candidates.duplicateConflicts.map((x) => ({
        fileName,
        ...x,
      })),
    );

    report.ignoredRows.push(
      ...candidates.ignoredRows.map((x) => ({
        fileName,
        ...x,
      })),
    );

    const amJson = buildAmJsonFromEn(
      enJson,
      flatEn,
      candidates,
      report,
      fileName,
    );

    const amPath = path.join(AM_DIR, `${fileName}.json`);
    fs.writeJsonSync(amPath, amJson, { spaces: 2 });

    console.log(`✅ Created/updated: ${amPath}`);
    report.summary.filesProcessed += 1;
  }

  report.summary.matchedCount = report.matched.length;
  report.summary.missingCount = report.missing.length;
  report.summary.duplicateConflictCount = report.duplicateConflicts.length;
  report.summary.ignoredRowCount = report.ignoredRows.length;
  report.summary.nonStringLeafCount = report.nonStringLeaves.length;
  report.summary.placeholderMismatchCount = report.placeholderMismatches.length;

  fs.writeJsonSync(REPORT_PATH, report, { spaces: 2 });

  console.log(`\n📝 Report written to: ${REPORT_PATH}`);
  console.log("\n🎉 Backend Amharic translation generation complete.");
})();
