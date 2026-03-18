const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");

// Input Excel file should have at least 3 columns: File/Directory, Key, Value.
const DEFAULT_FILE =
  "translations.xlsx";

const baseI18nDir =
  path.resolve(
    process.cwd(),
    "frontend/public/locales",
  );

function normalizeFileCell(
  rawFileCell,
) {
  if (
    !rawFileCell
  ) {
    return null;
  }

  let normalized =
    String(
      rawFileCell,
    )
      .trim()
      .replace(
        /\\/g,
        "/",
      );
  normalized =
    normalized
      .replace(
        /^\.\//,
        "",
      )
      .replace(
        /\/+/g,
        "/",
      );

  if (
    normalized
      .toLowerCase()
      .startsWith(
        "i18nfiles/",
      )
  ) {
    normalized =
      normalized.slice(
        "i18nFiles/"
          .length,
      );
  }

  if (
    normalized
      .toLowerCase()
      .endsWith(
        "/en.json",
      )
  ) {
    normalized =
      normalized.slice(
        0,
        -"/en.json"
          .length,
      );
  } else if (
    normalized
      .toLowerCase()
      .endsWith(
        ".json",
      )
  ) {
    normalized =
      path.posix.dirname(
        normalized,
      );
  }

  normalized =
    normalized.replace(
      /^\/+|\/+$/g,
      "",
    );
  return (
    normalized ||
    null
  );
}

function getPathParts(
  dotKey,
) {
  return String(
    dotKey,
  )
    .split(
      ".",
    )
    .map(
      (
        part,
      ) =>
        part.trim(),
    )
    .filter(
      Boolean,
    );
}

function hasNested(
  obj,
  dotKey,
) {
  const parts =
    getPathParts(
      dotKey,
    );
  let cursor =
    obj;

  for (const part of parts) {
    if (
      cursor ==
        null ||
      typeof cursor !==
        "object" ||
      !(
        part in
        cursor
      )
    ) {
      return false;
    }
    cursor =
      cursor[
        part
      ];
  }

  return true;
}

function setNested(
  obj,
  dotKey,
  value,
) {
  const parts =
    getPathParts(
      dotKey,
    );
  if (
    parts.length ===
    0
  ) {
    return;
  }

  let cursor =
    obj;
  for (
    let i = 0;
    i <
    parts.length -
      1;
    i += 1
  ) {
    const part =
      parts[
        i
      ];
    if (
      cursor[
        part
      ] ==
        null ||
      typeof cursor[
        part
      ] !==
        "object" ||
      Array.isArray(
        cursor[
          part
        ],
      )
    ) {
      cursor[
        part
      ] =
        {};
    }
    cursor =
      cursor[
        part
      ];
  }

  cursor[
    parts[
      parts.length -
        1
    ]
  ] =
    value;
}

function isLikelyHeaderRow(
  row,
) {
  const fileCell =
    String(
      row[0] ??
        "",
    )
      .trim()
      .toLowerCase();
  const keyCell =
    String(
      row[1] ??
        "",
    )
      .trim()
      .toLowerCase();
  const valueCell =
    String(
      row[2] ??
        "",
    )
      .trim()
      .toLowerCase();

  return (
    (fileCell.includes(
      "file",
    ) ||
      fileCell.includes(
        "directory",
      )) &&
    keyCell.includes(
      "key",
    ) &&
    (valueCell.includes(
      "value",
    ) ||
      valueCell.includes(
        "translation",
      ) ||
      valueCell.includes(
        "text",
      ))
  );
}

function readWorkbookRows(
  workbookPath,
) {
  const workbook =
    xlsx.readFile(
      workbookPath,
    );
  const grouped =
    {};

  for (const sheetName of workbook.SheetNames) {
    const sheet =
      workbook
        .Sheets[
        sheetName
      ];
    const rows =
      xlsx.utils.sheet_to_json(
        sheet,
        {
          header: 1,
          raw: false,
          defval:
            null,
        },
      );

    let currentDirectory =
      null;

    rows.forEach(
      (
        row,
        index,
      ) => {
        const fileCell =
          row[0];
        const keyCell =
          row[1];
        const valueCell =
          row[2];

        if (
          index ===
            0 &&
          isLikelyHeaderRow(
            row,
          )
        ) {
          return;
        }

        const normalizedFromRow =
          normalizeFileCell(
            fileCell,
          );
        if (
          normalizedFromRow
        ) {
          currentDirectory =
            normalizedFromRow;
        }

        const key =
          String(
            keyCell ??
              "",
          ).trim();
        if (
          !currentDirectory ||
          !key
        ) {
          return;
        }

        if (
          !grouped[
            currentDirectory
          ]
        ) {
          grouped[
            currentDirectory
          ] =
            [];
        }

        const value =
          valueCell ==
          null
            ? ""
            : String(
                valueCell,
              );
        grouped[
          currentDirectory
        ].push(
          {
            key,
            value,
          },
        );
      },
    );
  }

  return grouped;
}

function mergeGroupedTranslations(
  workbookGroups,
) {
  const merged =
    {};

  for (const grouped of workbookGroups) {
    for (const [
      dir,
      entries,
    ] of Object.entries(
      grouped,
    )) {
      if (
        !merged[
          dir
        ]
      ) {
        merged[
          dir
        ] =
          [];
      }
      merged[
        dir
      ].push(
        ...entries,
      );
    }
  }

  return merged;
}

function updateJsonFile(
  dirName,
  entries,
) {
  // FE translations structure.
  const fullPath =
    path.join(
      baseI18nDir,
      ...dirName.split(
        "/",
      ),
      "en.json",
    );

  // BE translations structure.
  // const fullPath =
  // path.join(
  //   baseI18nDir,
  //   dirName +
  //     ".json",
  // );

  console.log(
    `Updating: ${fullPath} with ${entries.length} entries`,
  );
  // return;

  if (
    !fs.existsSync(
      fullPath,
    )
  ) {
    console.warn(
      `File not found: ${fullPath}`,
    );
    return;
  }

  let json;
  try {
    json =
      JSON.parse(
        fs.readFileSync(
          fullPath,
          "utf8",
        ),
      );
  } catch (error) {
    console.error(
      `Failed to parse JSON: ${fullPath}`,
    );
    return;
  }

  let updatedCount = 0;
  let insertedCount = 0;

  for (const {
    key,
    value,
  } of entries) {
    const exists =
      hasNested(
        json,
        key,
      );
    setNested(
      json,
      key,
      value,
    );
    if (
      exists
    ) {
      updatedCount += 1;
    } else {
      insertedCount += 1;
    }
  }

  fs.writeFileSync(
    fullPath,
    `${JSON.stringify(json, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Updated ${fullPath} (${updatedCount} replaced, ${insertedCount} inserted)`,
  );
}

function main() {
  const inputFiles =
    process.argv.slice(
      2,
    );
  const filesToRead =
    inputFiles.length >
    0
      ? inputFiles
      : [
          DEFAULT_FILE,
        ];

  const workbookGroups =
    [];

  for (const inputPath of filesToRead) {
    const fullInputPath =
      path.resolve(
        process.cwd(),
        inputPath,
      );

    if (
      !fs.existsSync(
        fullInputPath,
      )
    ) {
      console.warn(
        `Excel file not found, skipped: ${fullInputPath}`,
      );
      continue;
    }

    console.log(
      `Reading workbook: ${fullInputPath}`,
    );
    workbookGroups.push(
      readWorkbookRows(
        fullInputPath,
      ),
    );
  }

  if (
    workbookGroups.length ===
    0
  ) {
    console.error(
      "No valid Excel file was provided.",
    );
    process.exit(
      1,
    );
  }

  const grouped =
    mergeGroupedTranslations(
      workbookGroups,
    );
  for (const [
    dirName,
    entries,
  ] of Object.entries(
    grouped,
  )) {
    updateJsonFile(
      dirName,
      entries,
    );
  }
}

main();
