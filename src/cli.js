const { run: runImport } = require("./commands/import-excel-to-json");
const { run: runExport } = require("./commands/export-json-to-excel");

function printHelp() {
  console.log("translation-tool <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  import   Apply translations from Excel into JSON files");
  console.log("  export   Export JSON keys/source text into Excel");
  console.log("");
  console.log("Examples:");
  console.log("  translation-tool export --layout backend --baseDir ./i18n_backend --sourceLang en --targetLang fr --out ./output/backend.xlsx");
  console.log("  translation-tool import --layout backend --baseDir ./i18n_backend --excel ./output/backend.xlsx --sheet Translations --sourceLang en --targetLang fr --applyMode missing-only");
  console.log("");
  console.log("Run '<command> --help' for command-specific options.");
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "import") {
    return runImport(rest);
  }

  if (command === "export") {
    return runExport(rest);
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
};
