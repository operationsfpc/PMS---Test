import {
  EXPORT_COLUMNS,
  type ExportRow,
  resumeHyperlink,
  type ShortlistEntry,
} from "@domain/recruiter-export";

/**
 * Answer 5a (2026-08-24): the recruiter pack is ONE zip — `shortlist.xlsx`
 * at the root, every resume in `resumes/`, each sheet row hyperlinking to
 * its candidate's file by RELATIVE path so the links survive being unzipped
 * anywhere.
 *
 * ExcelJS and JSZip are imported dynamically: they are export-day code, and
 * neither belongs in the bundle every login downloads.
 */
export interface PackFile {
  readonly rollNumber: string;
  readonly filename: string;
  readonly data: ArrayBuffer;
}

export async function buildRecruiterZip(
  companyName: string,
  rows: readonly ExportRow[],
  files: readonly PackFile[],
): Promise<Blob> {
  const [{ default: ExcelJS }, { default: JSZip }] = await Promise.all([
    import("exceljs"),
    import("jszip"),
  ]);

  const fileByRoll = new Map(files.map((f) => [f.rollNumber, f]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Shortlist");
  // Freeze header row (1) and columns up to register number and name (columns A & B: xSplit 2)
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  sheet.addRow([...EXPORT_COLUMNS, "Resume"]);
  sheet.getRow(1).font = { bold: true };

  const nameColIndex = EXPORT_COLUMNS.indexOf("Name") + 1;

  for (const row of rows) {
    const values = EXPORT_COLUMNS.map((column) => row[column]);
    const added = sheet.addRow([...values, ""]);
    const file = fileByRoll.get(String(row["Roll number"]));
    if (file !== undefined) {
      // UAT 2026-08-26: the target must be a URI, not a path. `resumes/124 -
      // Thanush Krishna.pdf` — raw spaces — is what Excel answered "Cannot
      // open the specified file" to. The TEXT stays human; the LINK is
      // encoded, exactly as Excel writes it itself.
      const link = resumeHyperlink(file.filename);
      added.getCell(nameColIndex).value = {
        text: String(row.Name),
        hyperlink: link,
      };
      added.getCell(EXPORT_COLUMNS.length + 1).value = {
        text: file.filename,
        hyperlink: link,
      };
    }
  }

  const zip = new JSZip();
  zip.file("shortlist.xlsx", await workbook.xlsx.writeBuffer());
  /**
   * Windows will happily open `shortlist.xlsx` from INSIDE the zip, into a
   * temp folder with no `resumes/` beside it — and every link then fails,
   * however correctly it is written. Say so on the way in.
   */
  zip.file(
    "README.txt",
    [
      `Recruiter pack — ${companyName}`,
      "",
      "1. Extract this zip to a folder before opening anything.",
      "   The Resume links in shortlist.xlsx are relative to the resumes/",
      "   folder beside it, so they cannot work while the file is still",
      "   inside the zip.",
      "2. Open shortlist.xlsx — one row per shortlisted candidate.",
      "3. Click the Resume cell in the last column to open that",
      "   candidate's CV from resumes/.",
      "",
      "Every CV is also in resumes/, named <roll number> - <name>.",
      "",
    ].join("\n"),
  );
  for (const file of files) {
    zip.file(`resumes/${file.filename}`, file.data);
  }

  return zip.generateAsync({
    type: "blob",
    // Named so the recruiter knows what landed in their downloads folder.
    comment: `Shortlist pack — ${companyName}`,
  });
}

/**
 * Builds a direct standalone Excel workbook (.xlsx) with signed URLs.
 * Freezes the header row and columns up to register number / name (columns A & B),
 * and hyperlinks candidate names directly to their resume PDFs.
 */
export async function buildRecruiterExcel(
  _companyName: string,
  entries: readonly ShortlistEntry[],
  resumeSignedUrls: ReadonlyMap<string, string>,
): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Shortlist");

  // Freezes top header row and columns up to register number & name (A & B)
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

  const headerRow = sheet.addRow([...EXPORT_COLUMNS, "Resume link"]);
  headerRow.font = { bold: true };

  const nameColIndex = EXPORT_COLUMNS.indexOf("Name") + 1;
  const resumeColIndex = EXPORT_COLUMNS.length + 1;

  const included = entries.filter((e) => e.included);
  for (const { snapshot } of included) {
    const p = snapshot.profile;
    const resumeUrl = snapshot.resumeId ? (resumeSignedUrls.get(snapshot.resumeId) ?? "") : "";
    const added = sheet.addRow([
      p.rollNumber,
      p.fullName,
      p.email,
      p.degree,
      p.branch,
      p.passingYear,
      p.overallCgpa,
      p.tenthPercentage,
      p.twelfthPercentage,
      p.currentArrears,
      p.historyOfArrears,
      p.technicalSkills,
      resumeUrl ? "View resume" : "",
    ]);

    if (resumeUrl) {
      added.getCell(nameColIndex).value = {
        text: p.fullName,
        hyperlink: resumeUrl,
      };
      added.getCell(nameColIndex).font = {
        color: { argb: "FF2563EB" },
        underline: true,
      };
      added.getCell(resumeColIndex).value = {
        text: "View resume",
        hyperlink: resumeUrl,
      };
      added.getCell(resumeColIndex).font = {
        color: { argb: "FF2563EB" },
        underline: true,
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
