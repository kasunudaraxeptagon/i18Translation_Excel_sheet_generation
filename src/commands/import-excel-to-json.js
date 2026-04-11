const fs = require("fs-extra");
const path = require("path");
const xlsx = require("xlsx");
const { parseArgs, resolvePathFromCwd, toBoolean, toList } = require("../lib/cli-utils");
const { safeReadJson } = require("../lib/file-utils");
const { deepClone, flattenObject, setNested, getLeafType } = require("../lib/object-utils");
const { normalizeFileName, normalizeText } = require("../lib/text-utils");
const { createLogger } = require("../lib/logger");

function getDefaults() {
  return {
    layout: "frontend",
    baseDir: "i18n_frontend",
    sourceLang: "en",
    targetLang: "target",
    excelPath: "translations.xlsx",
    reportPath: path.join("reports", "import_excel_to_json_report.json"),
    fileNameColumn: "Translation File Name",
    keyColumn: "Key",
    sourceTextColumn: "Source Translation",
    targetTextColumn: "Target Translation",
    fallbackToSource: true,
    applyMode: "missing-only",
    logLevel: "info",
  };
}

function getNested(obj, keyPath) {
  const parts = String(keyPath || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  let cursor = obj;

  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object" || !(part in cursor)) {
      return undefined;
    }

    cursor = cursor[part];
  }

  return cursor;
}

function hasText(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function listSourceFiles(options) {
  if (!fs.existsSync(options.baseDir)) {
    return [];
  }

  if (options.layout === "frontend") {
    return fs
      .readdirSync(options.baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const logicalName = entry.name;
        const sourcePath = path.join(options.baseDir, logicalName, `${options.sourceLang}.json`);
        const targetPath = path.join(options.baseDir, logicalName, `${options.targetLang}.json`);
        return { logicalName, normalizedName: normalizeFileName(logicalName), sourcePath, targetPath };
      })
      .filter((item) => fs.existsSync(item.sourcePath));
  }

  const sourceDir = path.join(options.baseDir, options.sourceLang);
  const targetDir = path.join(options.baseDir, options.targetLang);

  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => {
      const logicalName = entry.name.replace(/\.json$/i, "");
      return {
        logicalName,
        normalizedName: normalizeFileName(logicalName),
        sourcePath: path.join(sourceDir, entry.name),
        targetPath: path.join(targetDir, `${logicalName}.json`),
      };
    });
}

function collectRowsFromSheet(sheet, options) {
  const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const rows = [];
  let carryFileName = "";

  for (const rawRow of rawRows) {
    const fileNameCell = String(rawRow[options.fileNameColumn] || "").trim();
    const key = String(rawRow[options.keyColumn] || "").trim();
    const sourceText = normalizeText(rawRow[options.sourceTextColumn]);
    const targetText = normalizeText(rawRow[options.targetTextColumn]);

    if (fileNameCell) {
      carryFileName = fileNameCell;
    }

    if (!carryFileName && !key && !sourceText && !targetText) {
      continue;
    }

    rows.push({
      fileName: carryFileName,
      normalizedName: normalizeFileName(carryFileName),
      key,
      sourceText,
      targetText,
      original: rawRow,
    });
  }

  return rows;
}

function buildCandidateMaps(rows) {
  const byFile = new Map();

  for (const row of rows) {
    if (!row.normalizedName) {
      continue;
    }

    if (!byFile.has(row.normalizedName)) {
      byFile.set(row.normalizedName, { byKey: new Map(), bySource: new Map(), rows: [] });
    }

    const bucket = byFile.get(row.normalizedName);
    bucket.rows.push(row);

    if (!row.targetText) {
      continue;
    }

    if (row.key) {
      bucket.byKey.set(row.key, row.targetText);
    }
    if (row.sourceText) {
      bucket.bySource.set(row.sourceText, row.targetText);
    }
  }

  return byFile;
}

function applyMissingOnlyMode(sourceJson, existingTargetJson, candidate, options, counters) {
  const sourceFlat = flattenObject(sourceJson);
  const targetJson = deepClone(existingTargetJson || {});

  for (const [key, sourceValue] of Object.entries(sourceFlat)) {
    if (getLeafType(sourceValue) !== "string") {
      continue;
    }

    const currentTarget = getNested(targetJson, key);

    if (hasText(currentTarget)) {
      counters.skippedAlreadyTranslated += 1;
      continue;
    }

    const normalizedSource = normalizeText(sourceValue);
    const translated = candidate.byKey.get(key) || (normalizedSource ? candidate.bySource.get(normalizedSource) : null);

    if (hasText(translated)) {
      setNested(targetJson, key, translated);
      counters.appliedFromSheet += 1;
      continue;
    }

    if (options.fallbackToSource) {
      setNested(targetJson, key, sourceValue);
      counters.fallbackApplied += 1;
    } else {
      setNested(targetJson, key, "");
      counters.missingWithoutFallback += 1;
    }
  }

  return targetJson;
}

function applyFullMode(sourceJson, candidate, options, counters) {
  const sourceFlat = flattenObject(sourceJson);
  const targetJson = deepClone(sourceJson);

  for (const [key, sourceValue] of Object.entries(sourceFlat)) {
    if (getLeafType(sourceValue) !== "string") {
      continue;
    }

    const normalizedSource = normalizeText(sourceValue);
    const translated = candidate.byKey.get(key) || (normalizedSource ? candidate.bySource.get(normalizedSource) : null);

    if (hasText(translated)) {
      setNested(targetJson, key, translated);
      counters.appliedFromSheet += 1;
    } else if (options.fallbackToSource) {
      setNested(targetJson, key, sourceValue);
      counters.fallbackApplied += 1;
    } else {
      setNested(targetJson, key, "");
      counters.missingWithoutFallback += 1;
    }
  }

  return targetJson;
}

function applySheetOnlyMode(sourceJson, existingTargetJson, candidate, options, counters) {
  const targetJson = deepClone(existingTargetJson || sourceJson || {});

  for (const row of candidate.rows || []) {
    if (!row.key || !hasText(row.targetText)) {
      counters.ignoredSheetRows += 1;
      continue;
    }

    const currentTarget = getNested(targetJson, row.key);

    if (options.overwriteExisting || !hasText(currentTarget)) {
      setNested(targetJson, row.key, row.targetText);
      counters.appliedFromSheet += 1;
    } else {
      counters.skippedAlreadyTranslated += 1;
    }
  }

  return targetJson;
}

function processSheet(sheetName, sheet, sourceFiles, options, report, logger) {
  const rows = collectRowsFromSheet(sheet, options);
  const candidatesByFile = buildCandidateMaps(rows);

  logger.info("Processing sheet", { sheetName, rowCount: rows.length });

  const sourceFileByName = new Map(sourceFiles.map((item) => [item.normalizedName, item]));

  for (const [sheetFileName] of candidatesByFile.entries()) {
    if (!sourceFileByName.has(sheetFileName)) {
      const sample = rows.find((row) => row.normalizedName === sheetFileName);
      report.summary.sheetFilesMissingInSource.push(sample?.fileName || sheetFileName);
      logger.warn("Sheet file not found in source tree", { sheetName, file: sample?.fileName || sheetFileName });
    }
  }

  for (const sourceFile of sourceFiles) {
    const sourceJson = safeReadJson(sourceFile.sourcePath);

    if (!sourceJson) {
      report.skippedFiles.push({ file: sourceFile.logicalName, reason: "invalid_source_json" });
      logger.warn("Invalid source JSON, skipped", { file: sourceFile.sourcePath });
      continue;
    }

    const existingTargetJson = safeReadJson(sourceFile.targetPath) || {};
    const candidate = candidatesByFile.get(sourceFile.normalizedName) || { byKey: new Map(), bySource: new Map(), rows: [] };

    const counters = {
      appliedFromSheet: 0,
      skippedAlreadyTranslated: 0,
      fallbackApplied: 0,
      missingWithoutFallback: 0,
      ignoredSheetRows: 0,
    };

    let nextTargetJson;

    if (options.applyMode === "sheet-only") {
      nextTargetJson = applySheetOnlyMode(sourceJson, existingTargetJson, candidate, options, counters);
    } else if (options.applyMode === "full") {
      nextTargetJson = applyFullMode(sourceJson, candidate, options, counters);
    } else {
      nextTargetJson = applyMissingOnlyMode(sourceJson, existingTargetJson, candidate, options, counters);
    }

    fs.ensureDirSync(path.dirname(sourceFile.targetPath));
    fs.writeJsonSync(sourceFile.targetPath, nextTargetJson, { spaces: 2 });

    report.files.push({
      sheetName,
      file: sourceFile.logicalName,
      targetPath: sourceFile.targetPath,
      ...counters,
    });

    report.summary.filesProcessed += 1;
    report.summary.appliedFromSheet += counters.appliedFromSheet;
    report.summary.skippedAlreadyTranslated += counters.skippedAlreadyTranslated;
    report.summary.fallbackApplied += counters.fallbackApplied;
    report.summary.missingWithoutFallback += counters.missingWithoutFallback;
    report.summary.ignoredSheetRows += counters.ignoredSheetRows;

    logger.debug("File processed", {
      sheetName,
      file: sourceFile.logicalName,
      ...counters,
    });
  }
}

function run(argv = process.argv.slice(2)) {
  const defaults = getDefaults();
  const args = parseArgs(argv);

  if (args.help) {
    console.log("Usage: translation-tool import [--layout frontend|backend] [--baseDir <path>] [--excel <path>] [--sheet <name>] [--sheets <a,b>] [--sourceLang <code>] [--targetLang <code>] [--fileNameColumn <name>] [--keyColumn <name>] [--sourceTextColumn <name>] [--targetTextColumn <name>] [--applyMode missing-only|sheet-only|full] [--overwriteExisting true|false] [--fallbackToSource true|false] [--report <path>] [--logLevel error|warn|info|debug]");
    return 0;
  }

  const options = {
    layout: args.layout || defaults.layout,
    baseDir: resolvePathFromCwd(args.baseDir || defaults.baseDir),
    sourceLang: args.sourceLang || defaults.sourceLang,
    targetLang: args.targetLang || defaults.targetLang,
    excelPath: resolvePathFromCwd(args.excel || defaults.excelPath),
    reportPath: resolvePathFromCwd(args.report || defaults.reportPath),
    fileNameColumn: args.fileNameColumn || defaults.fileNameColumn,
    keyColumn: args.keyColumn || defaults.keyColumn,
    sourceTextColumn: args.sourceTextColumn || defaults.sourceTextColumn,
    targetTextColumn: args.targetTextColumn || defaults.targetTextColumn,
    fallbackToSource: toBoolean(args.fallbackToSource, defaults.fallbackToSource),
    overwriteExisting: toBoolean(args.overwriteExisting, true),
    applyMode: args.applyMode || defaults.applyMode,
    logLevel: args.logLevel || defaults.logLevel,
  };

  const logger = createLogger(options.logLevel);

  if (!["frontend", "backend"].includes(options.layout)) {
    logger.error("Invalid --layout. Use frontend or backend.");
    return 1;
  }

  if (!["missing-only", "sheet-only", "full"].includes(options.applyMode)) {
    logger.error("Invalid --applyMode. Use missing-only, sheet-only, or full.");
    return 1;
  }

  if (!fs.existsSync(options.excelPath)) {
    logger.error("Excel file not found", { path: options.excelPath });
    return 1;
  }

  const sourceFiles = listSourceFiles(options);
  if (!sourceFiles.length) {
    logger.error("No source JSON files found for given layout/baseDir/sourceLang.");
    return 1;
  }

  logger.info("Import started", {
    mode: options.applyMode,
    layout: options.layout,
    sourceFiles: sourceFiles.length,
    excel: options.excelPath,
  });

  const workbook = xlsx.readFile(options.excelPath);
  const requestedSheets = toList(args.sheets);
  const selectedSheets = requestedSheets.length
    ? requestedSheets
    : args.sheet
      ? [args.sheet]
      : workbook.SheetNames;

  const report = {
    createdAt: new Date().toISOString(),
    options,
    summary: {
      sourceFilesFound: sourceFiles.length,
      sheetsProcessed: 0,
      filesProcessed: 0,
      appliedFromSheet: 0,
      skippedAlreadyTranslated: 0,
      fallbackApplied: 0,
      missingWithoutFallback: 0,
      ignoredSheetRows: 0,
      sheetFilesMissingInSource: [],
      sheetsMissingInWorkbook: [],
    },
    files: [],
    skippedFiles: [],
  };

  for (const sheetName of selectedSheets) {
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      report.summary.sheetsMissingInWorkbook.push(sheetName);
      logger.warn("Requested sheet missing in workbook", { sheetName });
      continue;
    }

    processSheet(sheetName, sheet, sourceFiles, options, report, logger);
    report.summary.sheetsProcessed += 1;
  }

  fs.ensureDirSync(path.dirname(options.reportPath));
  fs.writeJsonSync(options.reportPath, report, { spaces: 2 });

  logger.info("Import completed", report.summary);
  logger.info("Report written", { path: options.reportPath });

  return 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run };
