const fs = require("fs-extra");
const path = require("path");
const xlsx = require("xlsx");
const { parseArgs, resolvePathFromCwd, toBoolean } = require("../lib/cli-utils");
const { safeReadJson } = require("../lib/file-utils");
const { flattenObject, getLeafType } = require("../lib/object-utils");
const { createLogger } = require("../lib/logger");

function getDefaults() {
  return {
    layout: "frontend",
    baseDir: "i18n_frontend",
    sourceLang: "en",
    targetLang: "target",
    outPath: path.join("output", "translations.xlsx"),
    sheetName: "Translations",
    fileNameColumn: "Translation File Name",
    keyColumn: "Key",
    sourceTextColumn: "Source Translation",
    targetTextColumn: "Target Translation",
    includeExistingTarget: true,
    onlyMissingTarget: false,
    logLevel: "info",
  };
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
        return { logicalName, sourcePath, targetPath };
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
        sourcePath: path.join(sourceDir, entry.name),
        targetPath: path.join(targetDir, `${logicalName}.json`),
      };
    });
}

function run(argv = process.argv.slice(2)) {
  const defaults = getDefaults();
  const args = parseArgs(argv);
  const pos = args._ || [];

  if (args.help) {
    console.log("Usage: translation-tool export [--layout frontend|backend] [--baseDir <path>] [--sourceLang <code>] [--targetLang <code>] [--out <xlsx>] [--sheet <name>] [--fileNameColumn <name>] [--keyColumn <name>] [--sourceTextColumn <name>] [--targetTextColumn <name>] [--includeExistingTarget true|false] [--onlyMissingTarget true|false] [--logLevel error|warn|info|debug]");
    return 0;
  }

  const options = {
    layout: args.layout || pos[0] || defaults.layout,
    baseDir: resolvePathFromCwd(args.baseDir || pos[1] || defaults.baseDir),
    sourceLang: args.sourceLang || pos[2] || defaults.sourceLang,
    targetLang: args.targetLang || pos[3] || defaults.targetLang,
    outPath: resolvePathFromCwd(args.out || pos[4] || defaults.outPath),
    sheetName: args.sheet || pos[5] || defaults.sheetName,
    fileNameColumn: args.fileNameColumn || defaults.fileNameColumn,
    keyColumn: args.keyColumn || defaults.keyColumn,
    sourceTextColumn: args.sourceTextColumn || defaults.sourceTextColumn,
    targetTextColumn: args.targetTextColumn || defaults.targetTextColumn,
    onlyMissingTarget: toBoolean(args.onlyMissingTarget ?? pos[6], defaults.onlyMissingTarget),
    includeExistingTarget: toBoolean(args.includeExistingTarget ?? pos[7], defaults.includeExistingTarget),
    logLevel: args.logLevel || pos[8] || defaults.logLevel,
  };

  const logger = createLogger(options.logLevel);

  if (!["frontend", "backend"].includes(options.layout)) {
    logger.error("Invalid --layout. Use frontend or backend.");
    return 1;
  }

  const sourceFiles = listSourceFiles(options);
  if (!sourceFiles.length) {
    logger.error("No source JSON files found for given layout/baseDir/sourceLang.");
    return 1;
  }

  logger.info("Export started", {
    layout: options.layout,
    sourceFiles: sourceFiles.length,
    onlyMissingTarget: options.onlyMissingTarget,
    includeExistingTarget: options.includeExistingTarget,
  });

  const rows = [];
  const summary = {
    filesProcessed: 0,
    sourceKeysSeen: 0,
    rowsExported: 0,
    rowsSkippedHasTarget: 0,
    invalidSourceFiles: 0,
  };

  for (const sourceFile of sourceFiles) {
    const sourceJson = safeReadJson(sourceFile.sourcePath);

    if (!sourceJson) {
      summary.invalidSourceFiles += 1;
      logger.warn("Invalid source JSON skipped", { file: sourceFile.sourcePath });
      continue;
    }

    const targetJson = safeReadJson(sourceFile.targetPath) || {};
    const flatSource = flattenObject(sourceJson);
    const flatTarget = flattenObject(targetJson);

    let fileRows = 0;

    for (const [key, sourceValue] of Object.entries(flatSource)) {
      if (getLeafType(sourceValue) !== "string") {
        continue;
      }

      summary.sourceKeysSeen += 1;

      const targetValue = flatTarget[key];
      const hasTargetValue = hasText(targetValue);

      if (options.onlyMissingTarget && hasTargetValue) {
        summary.rowsSkippedHasTarget += 1;
        continue;
      }

      rows.push({
        [options.fileNameColumn]: sourceFile.logicalName,
        [options.keyColumn]: key,
        [options.sourceTextColumn]: sourceValue,
        [options.targetTextColumn]:
          options.includeExistingTarget && hasTargetValue ? String(targetValue) : "",
      });

      fileRows += 1;
      summary.rowsExported += 1;
    }

    summary.filesProcessed += 1;
    logger.debug("File exported", { file: sourceFile.logicalName, rows: fileRows });
  }

  const headers = [
    options.fileNameColumn,
    options.keyColumn,
    options.sourceTextColumn,
    options.targetTextColumn,
  ];

  const worksheet = xlsx.utils.json_to_sheet(rows, { header: headers });
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, options.sheetName);

  fs.ensureDirSync(path.dirname(options.outPath));
  xlsx.writeFile(workbook, options.outPath);

  logger.info("Export completed", summary);
  logger.info("Workbook written", { path: options.outPath });

  return 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run };
