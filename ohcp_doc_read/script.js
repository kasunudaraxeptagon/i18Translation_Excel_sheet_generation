const fs = require("fs");
const path = require("path");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.mjs");
// update path and pdf name as neeeded : "extract_table_data.pdf" below.
class SIMPAHExtractor {
  constructor() {
    this.columns =
      [
        "Producto",
        "Origen",
        "Tamaño",
        "Unidad de Venta",
        "Rango Bajo",
        "Rango Alto",
        "Rango Moda Bajo",
        "Rango Moda Alto",
      ];
  }

  async extractPDF(
    pdfPath,
  ) {
    const pdfBuffer =
      fs.readFileSync(
        pdfPath,
      );
    const pdf =
      await pdfjsLib.getDocument(
        {
          data: new Uint8Array(
            pdfBuffer,
          ),
        },
      )
        .promise;

    const allPageText =
      [];
    let allRows =
      [];

    for (
      let i = 1;
      i <=
      pdf.numPages;
      i++
    ) {
      const page =
        await pdf.getPage(
          i,
        );
      const textContent =
        await page.getTextContent(
          {
            normalizeWhitespace: false,
            disableCombineTextItems: false,
          },
        );

      const items =
        this.normalizeItems(
          textContent.items,
          i,
        );
      allPageText.push(
        items
          .map(
            (
              it,
            ) =>
              it.str,
          )
          .join(
            " ",
          ),
      );

      const pageRows =
        this.extractRowsFromPage(
          items,
        );
      allRows =
        allRows.concat(
          pageRows,
        );
    }

    allRows =
      this.postProcessRows(
        allRows,
      );

    const result =
      {
        metadata:
          this.parseMetadata(
            allPageText.join(
              "\n",
            ),
          ),
        products:
          allRows,
        extractionQuality:
          this.assessQuality(
            allRows,
          ),
      };

    return result;
  }

  normalizeItems(
    items,
    pageNumber,
  ) {
    const toFinite =
      (
        v,
      ) => {
        const n =
          Number(
            v,
          );
        return Number.isFinite(
          n,
        )
          ? n
          : null;
      };

    const out =
      [];
    for (const item of items) {
      const raw =
        (
          item &&
          item.str
            ? String(
                item.str,
              )
            : ""
        ).trim();
      if (
        !raw
      )
        continue;

      const tr =
        Array.isArray(
          item.transform,
        )
          ? item.transform
          : [];

      const ix =
        toFinite(
          item.x,
        );
      const iy =
        toFinite(
          item.y,
        );
      const tx =
        toFinite(
          tr[4],
        );
      const ty =
        toFinite(
          tr[5],
        );
      const iw =
        toFinite(
          item.width,
        );
      const ih =
        toFinite(
          item.height,
        );

      const x =
        ix ??
        tx ??
        0;
      const y =
        iy ??
        ty ??
        0;
      const width =
        iw ??
        0;
      const height =
        ih ??
        0;

      out.push(
        {
          str: raw,
          x,
          y,
          width,
          height,
          pageNumber,
        },
      );
    }
    return out;
  }

  normalizeText(
    s,
  ) {
    return String(
      s ||
        "",
    )
      .normalize(
        "NFD",
      )
      .replace(
        /[\u0300-\u036f]/g,
        "",
      )
      .toLowerCase()
      .replace(
        /\s+/g,
        " ",
      )
      .trim();
  }

  groupLines(
    items,
    tolerance = 2.5,
  ) {
    const sorted =
      [
        ...items,
      ].sort(
        (
          a,
          b,
        ) => {
          const yd =
            b.y -
            a.y;
          if (
            Math.abs(
              yd,
            ) >
            tolerance
          )
            return yd;
          return (
            a.x -
            b.x
          );
        },
      );

    const lines =
      [];
    for (const item of sorted) {
      let found =
        null;
      for (const line of lines) {
        if (
          Math.abs(
            line.y -
              item.y,
          ) <=
          tolerance
        ) {
          found =
            line;
          break;
        }
      }

      if (
        !found
      ) {
        found =
          {
            y: item.y,
            items:
              [],
          };
        lines.push(
          found,
        );
      }

      found.items.push(
        item,
      );
      const n =
        found
          .items
          .length;
      found.y =
        (found.y *
          (n -
            1) +
          item.y) /
        n;
    }

    for (const line of lines) {
      line.items.sort(
        (
          a,
          b,
        ) =>
          a.x -
          b.x,
      );
      line.text =
        line.items
          .map(
            (
              it,
            ) =>
              it.str,
          )
          .join(
            " ",
          )
          .replace(
            /\s+/g,
            " ",
          )
          .trim();
    }

    lines.sort(
      (
        a,
        b,
      ) =>
        b.y -
        a.y,
    );
    return lines;
  }

  getTokenX(
    line,
    matcher,
  ) {
    const matchers =
      Array.isArray(
        matcher,
      )
        ? matcher
        : [
            matcher,
          ];

    for (const it of line.items) {
      const tRaw =
        this.normalizeText(
          it.str,
        );
      const t =
        tRaw.replace(
          /[|:;.,]/g,
          "",
        );

      for (const m of matchers) {
        if (
          m instanceof
            RegExp &&
          m.test(
            t,
          )
        ) {
          return it.x;
        }

        if (
          typeof m ===
            "string" &&
          t.includes(
            this.normalizeText(
              m,
            ),
          )
        ) {
          return it.x;
        }
      }
    }

    return null;
  }

  detectHeaderTemplate(
    lines,
  ) {
    let main =
      null;

    for (const line of lines) {
      const t =
        this.normalizeText(
          line.text,
        );
      const hasMainHeaders =
        t.includes(
          "producto",
        ) &&
        t.includes(
          "origen",
        ) &&
        t.includes(
          "tamano",
        ) &&
        t.includes(
          "unidad",
        ) &&
        t.includes(
          "venta",
        );

      if (
        hasMainHeaders
      ) {
        main =
          line;
        break;
      }
    }

    if (
      !main
    )
      return null;

    let sub =
      null;
    for (const line of lines) {
      if (
        line.y >=
        main.y
      )
        continue;
      if (
        main.y -
          line.y >
        80
      )
        continue;

      const t =
        this.normalizeText(
          line.text,
        );
      const bajoCount =
        (
          t.match(
            /\bbajo\b/g,
          ) ||
          []
        )
          .length;
      const altoCount =
        (
          t.match(
            /\balto\b/g,
          ) ||
          []
        )
          .length;

      if (
        bajoCount +
          altoCount >=
        2
      ) {
        sub =
          line;
        if (
          bajoCount +
            altoCount >=
          4
        )
          break;
      }
    }

    const productoX =
      this.getTokenX(
        main,
        [
          /\bproducto\b/i,
          "producto",
        ],
      );
    const origenX =
      this.getTokenX(
        main,
        [
          /\borigen\b/i,
          "origen",
        ],
      );
    const tamanoX =
      this.getTokenX(
        main,
        [
          /\btamano\b/i,
          "tamano",
        ],
      );
    const unidadX =
      this.getTokenX(
        main,
        [
          /\bunidad\b/i,
          "unidad de venta",
          "unidad",
        ],
      );

    if (
      [
        productoX,
        origenX,
        tamanoX,
        unidadX,
      ].some(
        (
          v,
        ) =>
          v ===
          null,
      )
    ) {
      return null;
    }

    let priceXs =
      [];

    const collectPriceXs =
      (
        line,
      ) => {
        for (const it of line.items) {
          const t =
            this.normalizeText(
              it.str,
            ).replace(
              /[|:;.,]/g,
              "",
            );
          if (
            (t ===
              "bajo" ||
              t ===
                "alto") &&
            it.x >
              unidadX +
                2
          ) {
            priceXs.push(
              it.x,
            );
          }
        }
      };

    if (
      sub
    ) {
      collectPriceXs(
        sub,
      );
    }

    for (const line of lines) {
      if (
        Math.abs(
          main.y -
            line.y,
        ) >
        100
      )
        continue;
      collectPriceXs(
        line,
      );
    }

    priceXs =
      priceXs
        .sort(
          (
            a,
            b,
          ) =>
            a -
            b,
        )
        .filter(
          (
            x,
            idx,
            arr,
          ) =>
            idx ===
              0 ||
            Math.abs(
              x -
                arr[
                  idx -
                    1
                ],
            ) >
              8,
        )
        .slice(
          0,
          4,
        );

    if (
      priceXs.length <
      4
    )
      return null;

    const starts =
      [
        productoX,
        origenX,
        tamanoX,
        unidadX,
        priceXs[0],
        priceXs[1],
        priceXs[2],
        priceXs[3],
      ];

    for (
      let i = 0;
      i <
      starts.length -
        1;
      i++
    ) {
      if (
        !(
          starts[
            i +
              1
          ] >
          starts[
            i
          ]
        )
      )
        return null;
    }

    const boundaries =
      [];
    for (
      let i = 0;
      i <
      starts.length -
        1;
      i++
    ) {
      boundaries.push(
        (starts[
          i
        ] +
          starts[
            i +
              1
          ]) /
          2,
      );
    }

    const headerBottomY =
      sub
        ? Math.min(
            main.y,
            sub.y,
          )
        : main.y;

    return {
      starts,
      boundaries,
      headerBottomY,
    };
  }

  isNoiseLine(
    text,
  ) {
    const t =
      this.normalizeText(
        text,
      );
    if (
      !t
    )
      return true;

    const noisePatterns =
      [
        /\bsimpah\b/,
        /\bpagina\b/,
        /\btasa de cambio\b/,
        /\bprecios\b/,
        /\bfuente\b/,
        /\blempira\b/,
        /\busd\b/,
        /\bhnl\b/,
        /\bmercado central\b/,
        /\bcodigo reporte\b/,
        /\btel\b\s*:/, // only telephone label, not Tela
      ];

    return noisePatterns.some(
      (
        re,
      ) =>
        re.test(
          t,
        ),
    );
  }

  projectLineToCells(
    items,
    boundaries,
  ) {
    const cols =
      [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
      ];

    for (const it of items) {
      const center =
        it.x +
        (it.width ||
          0) /
          2;
      let idx = 0;
      while (
        idx <
          boundaries.length &&
        center >
          boundaries[
            idx
          ]
      )
        idx++;
      if (
        idx <
        0
      )
        idx = 0;
      if (
        idx >
        7
      )
        idx = 7;
      cols[
        idx
      ].push(
        it.str,
      );
    }

    return cols.map(
      (
        parts,
      ) =>
        this.cleanCellText(
          parts.join(
            " ",
          ),
        ),
    );
  }

  cleanCellText(
    s,
  ) {
    return String(
      s ||
        "",
    )
      .replace(
        /\s+/g,
        " ",
      )
      .replace(
        /^[|;:\s]+/,
        "",
      )
      .replace(
        /[|;:\s]+$/,
        "",
      )
      .trim();
  }

  parseNumber(
    value,
  ) {
    let s =
      String(
        value ||
          "",
      )
        .replace(
          /[^\d.,-]/g,
          "",
        )
        .trim();
    if (
      !s
    )
      return null;

    if (
      /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(
        s,
      )
    ) {
      s =
        s
          .replace(
            /\./g,
            "",
          )
          .replace(
            ",",
            ".",
          );
    } else if (
      /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(
        s,
      )
    ) {
      s =
        s.replace(
          /,/g,
          "",
        );
    } else if (
      s.includes(
        ",",
      ) &&
      !s.includes(
        ".",
      )
    ) {
      s =
        s.replace(
          ",",
          ".",
        );
    }

    const n =
      parseFloat(
        s,
      );
    return Number.isFinite(
      n,
    )
      ? n
      : null;
  }

  cellsToRow(
    cells,
  ) {
    if (
      !cells ||
      cells.length !==
        8
    )
      return null;

    return {
      producto:
        cells[0],
      origen:
        cells[1],
      tamaño:
        cells[2],
      unidadVenta:
        cells[3],
      rango:
        {
          bajo: this.parseNumber(
            cells[4],
          ),
          alto: this.parseNumber(
            cells[5],
          ),
        },
      rangoModa:
        {
          bajo: this.parseNumber(
            cells[6],
          ),
          alto: this.parseNumber(
            cells[7],
          ),
        },
    };
  }

  forwardFillMerged(
    row,
    prevRow,
  ) {
    if (
      !prevRow
    )
      return row;

    const fields =
      [
        "producto",
        "origen",
        "tamaño",
        "unidadVenta",
      ];
    for (const f of fields) {
      if (
        !row[
          f
        ] ||
        !row[
          f
        ].trim()
      ) {
        row[
          f
        ] =
          prevRow[
            f
          ] ||
          "";
      }
    }
    return row;
  }

  isDataRow(
    row,
  ) {
    if (
      !row
    )
      return false;

    const hasText =
      [
        row.producto,
        row.origen,
        row.tamaño,
        row.unidadVenta,
      ].some(
        (
          v,
        ) =>
          String(
            v ||
              "",
          ).trim() !==
          "",
      );

    const hasNumber =
      [
        row
          .rango
          .bajo,
        row
          .rango
          .alto,
        row
          .rangoModa
          .bajo,
        row
          .rangoModa
          .alto,
      ].some(
        (
          v,
        ) =>
          typeof v ===
            "number" &&
          !Number.isNaN(
            v,
          ),
      );

    if (
      !hasText ||
      !hasNumber
    )
      return false;
    if (
      this.isNoiseLine(
        row.producto,
      )
    )
      return false;
    return true;
  }

  extractRowsFromPage(
    items,
  ) {
    const lines =
      this.groupLines(
        items,
        2.5,
      );
    const template =
      this.detectHeaderTemplate(
        lines,
      );
    if (
      !template
    ) {
      if (
        this.debugEnabled()
      ) {
        console.log(
          "[DEBUG] template_not_found_on_page",
        );
      }
      return [];
    }

    const rows =
      [];
    let prevRow =
      null;

    for (const line of lines) {
      const debugLine =
        this.debugEnabled() &&
        this.isDebugTargetText(
          line.text,
        );

      if (
        line.y >=
        template.headerBottomY -
          1
      ) {
        if (
          debugLine
        ) {
          console.log(
            "[DROP:header_zone]",
            line.text,
          );
        }
        continue;
      }

      if (
        this.isNoiseLine(
          line.text,
        )
      ) {
        if (
          debugLine
        ) {
          console.log(
            "[DROP:noise_line]",
            line.text,
          );
        }
        continue;
      }

      const cells =
        this.projectLineToCells(
          line.items,
          template.boundaries,
        );

      let row =
        this.cellsToRow(
          cells,
        );

      if (
        debugLine
      ) {
        console.log(
          "[CANDIDATE:line]",
          line.text,
        );
        console.log(
          "[CANDIDATE:cells]",
          cells,
        );
      }

      if (
        !row
      ) {
        if (
          debugLine
        ) {
          console.log(
            "[DROP:cellsToRow_null]",
          );
        }
        continue;
      }

      row =
        this.forwardFillMerged(
          row,
          prevRow,
        );

      const reasons =
        this.rowDropReasons(
          row,
        );

      if (
        reasons.length >
        0
      ) {
        if (
          debugLine ||
          (this.debugEnabled() &&
            this.isDebugTargetText(
              row.producto,
            ))
        ) {
          console.log(
            "[DROP:isDataRow]",
            {
              reasons,
              line: line.text,
              row,
              cells,
            },
          );
        }
        continue;
      }

      if (
        this.debugEnabled() &&
        this.isDebugTargetText(
          row.producto,
        )
      ) {
        console.log(
          "[KEEP:extractRowsFromPage]",
          row,
        );
      }

      rows.push(
        row,
      );
      prevRow =
        row;
    }

    return rows;
  }

  postProcessRows(
    rows,
  ) {
    const out =
      [];
    const seen =
      new Set();

    for (const row of rows) {
      row.producto =
        String(
          row.producto ||
            "",
        ).trim();
      row.origen =
        String(
          row.origen ||
            "",
        ).trim();
      row.tamaño =
        String(
          row.tamaño ||
            "",
        ).trim();
      row.unidadVenta =
        String(
          row.unidadVenta ||
            "",
        ).trim();

      if (
        !row.producto
      )
        continue;
      if (
        row
          .rango
          .bajo ===
          null &&
        row
          .rango
          .alto ===
          null &&
        row
          .rangoModa
          .bajo ===
          null &&
        row
          .rangoModa
          .alto ===
          null
      ) {
        if (
          rowDebug
        )
          console.log(
            "[DROP:post_all_prices_null]",
            row,
          );
        continue;
      }

      const key =
        [
          row.producto,
          row.origen,
          row.tamaño,
          row.unidadVenta,
          row
            .rango
            .bajo,
          row
            .rango
            .alto,
          row
            .rangoModa
            .bajo,
          row
            .rangoModa
            .alto,
        ].join(
          "|",
        );

      if (
        seen.has(
          key,
        )
      ) {
        if (
          rowDebug
        )
          console.log(
            "[DROP:post_dedupe]",
            {
              key,
              row,
            },
          );
        continue;
      }

      seen.add(
        key,
      );
      out.push(
        row,
      );
    }

    return out;
  }

  parseMetadata(
    text,
  ) {
    const metadata =
      {};

    const reportMatch =
      text.match(
        /Código reporte:\s*([^\n]+)/i,
      );
    metadata.reportCode =
      reportMatch
        ? reportMatch[1].trim()
        : null;

    const dateMatch =
      text.match(
        /([Ll]unes|[Mm]artes|[Mm]i[eé]rcoles|[Jj]ueves|[Vv]iernes|[Ss][áa]bado|[Dd]omingo),?\s+(\d{1,2})\s+de\s+(\w+)\s+del\s+(\d{4})/,
      );
    metadata.date =
      dateMatch
        ? {
            raw: dateMatch[0],
            day: dateMatch[2],
            month:
              dateMatch[3],
            year: dateMatch[4],
          }
        : null;

    const exchangeMatch =
      text.match(
        /Tasa de Cambio:\s*1 USD = ([\d.,]+)\s*HNL/i,
      );
    if (
      exchangeMatch
    ) {
      metadata.exchangeRate =
        this.parseNumber(
          exchangeMatch[1],
        );
    } else {
      metadata.exchangeRate =
        null;
    }

    return metadata;
  }

  assessQuality(
    rows,
  ) {
    if (
      !rows.length
    )
      return "failed";

    let strong = 0;
    for (const r of rows) {
      const ok =
        r.producto &&
        r.tamaño &&
        r.unidadVenta &&
        r
          .rango
          .bajo !==
          null &&
        r
          .rango
          .alto !==
          null;
      if (
        ok
      )
        strong++;
    }

    const ratio =
      strong /
      rows.length;
    if (
      ratio >=
      0.95
    )
      return "excellent";
    if (
      ratio >=
      0.85
    )
      return "good";
    if (
      ratio >=
      0.7
    )
      return "fair";
    return "poor";
  }

  csvEscape(
    v,
  ) {
    if (
      v ===
        null ||
      v ===
        undefined
    )
      return "";
    const s =
      String(
        v,
      );
    return (
      '"' +
      s.replace(
        /"/g,
        '""',
      ) +
      '"'
    );
  }

  toCSV(
    extractedData,
  ) {
    const header =
      this.columns.join(
        ",",
      );
    const rows =
      extractedData.products.map(
        (
          r,
        ) =>
          [
            this.csvEscape(
              r.producto,
            ),
            this.csvEscape(
              r.origen,
            ),
            this.csvEscape(
              r.tamaño,
            ),
            this.csvEscape(
              r.unidadVenta,
            ),
            r
              .rango
              .bajo ??
              "",
            r
              .rango
              .alto ??
              "",
            r
              .rangoModa
              .bajo ??
              "",
            r
              .rangoModa
              .alto ??
              "",
          ].join(
            ",",
          ),
      );

    return (
      header +
      "\n" +
      rows.join(
        "\n",
      ) +
      "\n"
    );
  }

  toJSON(
    extractedData,
  ) {
    return JSON.stringify(
      extractedData,
      null,
      2,
    );
  }

  debugEnabled() {
    return (
      process
        .env
        .DEBUG_NANCE ===
      "1"
    );
  }

  isDebugTargetText(
    text,
  ) {
    const t =
      this.normalizeText(
        text ||
          "",
      );
    return (
      t.includes(
        "mora",
      ) ||
      t.includes(
        "nance",
      ) ||
      t.includes(
        "naranja",
      )
    );
  }

  rowDropReasons(
    row,
  ) {
    const reasons =
      [];
    if (
      !row
    ) {
      reasons.push(
        "row_null",
      );
      return reasons;
    }

    const hasText =
      [
        row.producto,
        row.origen,
        row.tamaño,
        row.unidadVenta,
      ].some(
        (
          v,
        ) =>
          String(
            v ||
              "",
          ).trim() !==
          "",
      );

    const hasNumber =
      [
        row
          .rango
          ?.bajo,
        row
          .rango
          ?.alto,
        row
          .rangoModa
          ?.bajo,
        row
          .rangoModa
          ?.alto,
      ].some(
        (
          v,
        ) =>
          typeof v ===
            "number" &&
          !Number.isNaN(
            v,
          ),
      );

    if (
      !hasText
    )
      reasons.push(
        "no_text",
      );
    if (
      !hasNumber
    )
      reasons.push(
        "no_number",
      );
    if (
      this.isNoiseLine(
        row.producto,
      )
    )
      reasons.push(
        "producto_noise",
      );

    return reasons;
  }
}

async function main() {
  const extractor =
    new SIMPAHExtractor();
  const pdfPath =
    path.join(
      __dirname,
      "../extract_table_data.pdf",
    );

  try {
    console.log(
      "Extracting PDF...",
    );
    const result =
      await extractor.extractPDF(
        pdfPath,
      );

    const outputDir =
      path.join(
        __dirname,
        "output",
      );
    if (
      !fs.existsSync(
        outputDir,
      )
    ) {
      fs.mkdirSync(
        outputDir,
        {
          recursive: true,
        },
      );
    }

    fs.writeFileSync(
      path.join(
        outputDir,
        "extracted_data.json",
      ),
      extractor.toJSON(
        result,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(
        outputDir,
        "extracted_data.csv",
      ),
      extractor.toCSV(
        result,
      ),
      "utf8",
    );

    console.log(
      "Done.",
    );
    console.log(
      "Rows:",
      result
        .products
        .length,
    );
    console.log(
      "Quality:",
      result.extractionQuality,
    );
    console.log(
      "JSON:",
      path.join(
        outputDir,
        "extracted_data.json",
      ),
    );
    console.log(
      "CSV:",
      path.join(
        outputDir,
        "extracted_data.csv",
      ),
    );
  } catch (error) {
    console.error(
      "Extraction failed:",
      error.message,
    );
    process.exit(
      1,
    );
  }
}

if (
  require.main ===
  module
) {
  main();
}

module.exports =
  SIMPAHExtractor;
