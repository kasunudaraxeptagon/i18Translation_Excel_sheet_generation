# Translation Tool CLI

A generic CLI for managing translations between Excel sheets and JSON language files.

## CLI Commands

- `translation-tool export` -> export source JSON keys/text to Excel
- `translation-tool import` -> import Excel translations to target JSON

You can run via:

```bash
npm run translation-tool -- <command> [options]
```

Or directly:

```bash
node bin/translation-tool.js <command> [options]
```

## Install

```bash
npm install
```

## Export: JSON -> Excel

```bash
npm run export:json-to-excel -- \
  --layout frontend \
  --baseDir ./i18n_frontend \
  --sourceLang en \
  --targetLang fr \
  --out ./output/frontend_translations.xlsx \
  --sheet Translations \
  --onlyMissingTarget true \
  --includeExistingTarget true \
  --logLevel info
```

## Import: Excel -> JSON

```bash
npm run import:excel-to-json -- \
  --layout frontend \
  --baseDir ./i18n_frontend \
  --excel ./output/frontend_translations.xlsx \
  --sheet Translations \
  --sourceLang en \
  --targetLang fr \
  --applyMode missing-only \
  --fallbackToSource true \
  --report ./reports/import_frontend.json \
  --logLevel info
```

## Important Scenarios

### 1) Mid-project incremental translation (keep existing translations)

Use:

- `--applyMode missing-only`
- optional `--fallbackToSource true|false`

Behavior:

- compares source and existing target JSON
- only fills keys that are missing/empty in target
- does not overwrite already translated keys

### 2) Apply only client-provided translations (even if target already has text)

Use:

- `--applyMode sheet-only`
- `--overwriteExisting true`

Behavior:

- only keys present in the Excel sheet are applied
- existing values are replaced for those keys
- keys not present in the sheet remain unchanged

## Layouts

- `--layout frontend`
  - source: `<baseDir>/<module>/<sourceLang>.json`
  - target: `<baseDir>/<module>/<targetLang>.json`

- `--layout backend`
  - source: `<baseDir>/<sourceLang>/<file>.json`
  - target: `<baseDir>/<targetLang>/<file>.json`

## Column Mapping Options

Default expected headers in Excel:

- `Translation File Name`
- `Key`
- `Source Translation`
- `Target Translation`

All are configurable with:

- `--fileNameColumn`
- `--keyColumn`
- `--sourceTextColumn`
- `--targetTextColumn`

## Logging

Use `--logLevel error|warn|info|debug`.

The CLI logs with timestamps and structured summaries, including counts such as:

- files processed
- applied from sheet
- skipped because already translated
- fallback applied
- missing without fallback

## Help

```bash
npm run translation-tool -- --help
npm run translation-tool -- import --help
npm run translation-tool -- export --help
```
