import { EXPORT_COLUMNS, type ExportRow } from "@domain/recruiter-export";

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
  sheet.addRow([...EXPORT_COLUMNS, "Resume"]);
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const values = EXPORT_COLUMNS.map((column) => row[column]);
    const added = sheet.addRow([...values, ""]);
    const file = fileByRoll.get(String(row["Roll number"]));
    if (file !== undefined) {
      added.getCell(EXPORT_COLUMNS.length + 1).value = {
        text: file.filename,
        hyperlink: `resumes/${file.filename}`,
      };
    }
  }

  const zip = new JSZip();
  zip.file("shortlist.xlsx", await workbook.xlsx.writeBuffer());
  for (const file of files) {
    zip.file(`resumes/${file.filename}`, file.data);
  }

  return zip.generateAsync({
    type: "blob",
    // Named so the recruiter knows what landed in their downloads folder.
    comment: `Shortlist pack — ${companyName}`,
  });
}
