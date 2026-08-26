import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildRecruiterZip } from "./export-pack";

/**
 * Answer 5a (2026-08-24): "all resumes in one folder. inside folder have an
 * excel sheet also with student details and hyperlink to resume. zip the
 * folder."
 *
 * One zip: `shortlist.xlsx` at the root beside a `resumes/` folder, each row
 * of the sheet hyperlinking to its candidate's file — relative paths, so the
 * links survive being unzipped anywhere.
 */
const rows = [
  {
    "Roll number": "124",
    Name: "Thanush Krishna",
    Email: "t@x.in",
    Degree: "BCA",
    Branch: "AI and DS",
    "Passing year": 2027,
    "Overall CGPA": 7.5,
    "10th %": 95,
    "12th %": 92,
    "Standing arrears": 0,
    "Arrear history": 0,
    "Technical skills": "React",
  },
];

const files = [
  {
    rollNumber: "124",
    filename: "124 - Thanush Krishna.pdf",
    data: new Uint8Array([37, 80, 68, 70]).buffer,
  },
];

describe("buildRecruiterZip", () => {
  it("packs the sheet beside a resumes folder, hyperlinked row by row", async () => {
    const blob = await buildRecruiterZip("Zoho", rows, files);

    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(zip.file("shortlist.xlsx")).not.toBeNull();
    expect(zip.file("resumes/124 - Thanush Krishna.pdf")).not.toBeNull();

    const sheetBytes = await zip.file("shortlist.xlsx")?.async("arraybuffer");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(sheetBytes as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();

    // Header row: the export columns plus the Resume link column.
    const header = sheet?.getRow(1).values as unknown[];
    expect(header).toContain("Roll number");
    expect(header).toContain("Resume");

    // The data row carries the candidate and links to their file.
    const dataRow = sheet?.getRow(2);
    expect(dataRow?.getCell(1).value).toBe("124");
    const linkCell = dataRow?.getCell(header.indexOf("Resume")).value as {
      hyperlink?: string;
      text?: string;
    };
    // SPEC CHANGE 2026-08-26: the target is percent-encoded — a raw path is
    // what Excel refused to open. The file still sits under the readable name.
    expect(linkCell?.hyperlink).toBe("resumes/124%20-%20Thanush%20Krishna.pdf");
  });

  it("leaves the Resume cell plain when a row has no matching file", async () => {
    const blob = await buildRecruiterZip("Zoho", rows, []);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const sheetBytes = await zip.file("shortlist.xlsx")?.async("arraybuffer");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(sheetBytes as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    const header = sheet?.getRow(1).values as unknown[];
    const cell = sheet?.getRow(2).getCell(header.indexOf("Resume"));
    expect(cell?.value ?? "").not.toHaveProperty("hyperlink");
  });
});

/**
 * UAT 2026-08-26 (live): "the resume file name of each student is mentioned
 * in the CSV file but clicking that is not auto opening the PDF resume — the
 * hyperlink seems to be broken." Excel: "Cannot open the specified file."
 *
 * The relationship target was written with raw spaces. Excel percent-encodes
 * a file link and cannot follow one that is not encoded, so the sheet pointed
 * at nothing while the resume sat in the zip beside it.
 */
describe("the Resume link a recruiter actually clicks", () => {
  async function packed(name = "124 - Thanush Krishna.pdf") {
    const blob = await buildRecruiterZip("Zoho", rows, [
      { rollNumber: "124", filename: name, data: new Uint8Array([37, 80, 68, 70]).buffer },
    ]);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const sheetBytes = await zip.file("shortlist.xlsx")?.async("arraybuffer");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(sheetBytes as ArrayBuffer);
    return { zip, workbook };
  }

  it("writes a target Excel can follow — percent-encoded, not a raw path", async () => {
    const { workbook } = await packed();
    const sheet = workbook.worksheets[0];
    const header = sheet?.getRow(1).values as unknown[];
    const cell = sheet?.getRow(2).getCell(header.indexOf("Resume")).value as {
      hyperlink?: string;
      text?: string;
    };

    expect(cell?.hyperlink).toBe("resumes/124%20-%20Thanush%20Krishna.pdf");
    // The recruiter still READS the human name, encoded or not.
    expect(cell?.text).toBe("124 - Thanush Krishna.pdf");
  });

  it("stores the file under the readable name the link resolves to", async () => {
    const { zip } = await packed();
    expect(zip.file("resumes/124 - Thanush Krishna.pdf")).not.toBeNull();
  });

  it("tells the recruiter to extract the pack — links cannot resolve inside a zip", async () => {
    const { zip } = await packed();
    const readme = await zip.file("README.txt")?.async("string");
    expect(readme).toMatch(/extract/i);
    expect(readme).toMatch(/shortlist\.xlsx/);
    expect(readme).toMatch(/Zoho/);
  });
});
