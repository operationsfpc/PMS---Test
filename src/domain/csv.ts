/**
 * A minimal RFC 4180 reader.
 *
 * Written rather than pulled in as a dependency: the roster is the only CSV
 * this system reads, and a corrupted row means a student who cannot sign in,
 * so the parsing rules are worth owning and testing outright.
 *
 * Handles the four things college exports actually do that break a naive
 * `split(",")`: quoted fields containing commas, doubled quotes, embedded
 * newlines, and the UTF-8 BOM Excel writes at the start of a file.
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  if (input.trim() === "") return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Swallow the LF of a CRLF pair.
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // A trailing newline must not invent a blank final row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * The writing half of the reader above (WS8, 2026-08-12): the shortlist
 * export is a CSV Excel opens. RFC 4180: CRLF line ends, quotes doubled,
 * fields quoted when they contain a comma, a quote or a newline. A missing
 * value is a blank field — never the string "undefined".
 *
 * The BOM Excel needs to read UTF-8 is the DOWNLOAD's concern, not the
 * serialiser's: prefixing it here would break round-tripping through
 * `parseCsv` and corrupt any consumer that concatenates files.
 */
export function serialiseCsv(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, string | number | undefined>>[],
): string {
  const field = (value: string | number | undefined): string => {
    if (value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  const lines = [
    columns.map(field).join(","),
    ...rows.map((row) => columns.map((column) => field(row[column])).join(",")),
  ];
  return lines.join("\r\n");
}
