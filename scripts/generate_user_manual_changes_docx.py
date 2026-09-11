import os
from pathlib import Path
import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import parse_xml

def set_cell_background(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="clear" w:color="auto" w:fill="{hex_color}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=80, bottom=80, left=120, right=120):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'''
        <w:tcMar xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:top w:w="{top}" w:type="dxa"/>
            <w:bottom w:w="{bottom}" w:type="dxa"/>
            <w:left w:w="{left}" w:type="dxa"/>
            <w:right w:w="{right}" w:type="dxa"/>
        </w:tcMar>
    ''')
    tcPr.append(tcMar)

def set_table_borders(table, color="D0D5DD"):
    tblPr = table._tbl.tblPr
    borders = parse_xml(
        f'<w:tblBorders xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'  <w:top w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
        f'  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
        f'  <w:insideH w:val="single" w:sz="4" w:space="0" w:color="{color}"/>'
        f'  <w:insideV w:val="none"/>'
        f'  <w:left w:val="none"/>'
        f'  <w:right w:val="none"/>'
        f'</w:tblBorders>'
    )
    tblPr.append(borders)

def build_simple_user_manual_changes_docx(output_path: Path):
    doc = Document()

    # Set page margins
    for section in doc.sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.8)
        section.right_margin = Inches(0.8)

        # Header / Footer
        header = section.header
        hp = header.paragraphs[0]
        hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        hrun = hp.add_run("FPC Placement Management System — Release Summary")
        hrun.font.name = "Segoe UI"
        hrun.font.size = Pt(8.5)
        hrun.font.color.rgb = RGBColor(150, 150, 150)

        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        frun = fp.add_run("Confidential — Placement Operations Documentation — September 2026")
        frun.font.name = "Segoe UI"
        frun.font.size = Pt(8.5)
        frun.font.color.rgb = RGBColor(150, 150, 150)

    # Brand Colors
    PRIMARY = RGBColor(61, 55, 119)     # Deep Indigo #3D3777
    SECONDARY = RGBColor(217, 119, 6)   # Amber #D97706
    TEXT = RGBColor(40, 40, 40)         # Charcoal
    MUTED = RGBColor(100, 116, 139)     # Slate

    # 1. Document Title
    p_title = doc.add_paragraph()
    p_title.paragraph_format.space_before = Pt(0)
    p_title.paragraph_format.space_after = Pt(2)
    r_brand = p_title.add_run("FACE Prep Campus — PMS\n")
    r_brand.font.name = "Segoe UI"
    r_brand.font.size = Pt(12)
    r_brand.font.bold = True
    r_brand.font.color.rgb = SECONDARY

    r_main = p_title.add_run("Recent System Changes & User Manual Summary")
    r_main.font.name = "Segoe UI"
    r_main.font.size = Pt(18)
    r_main.font.bold = True
    r_main.font.color.rgb = PRIMARY

    p_sub = doc.add_paragraph()
    p_sub.paragraph_format.space_after = Pt(14)
    r_sub = p_sub.add_run("Key updates to Student Registration (SRF) and Coordinator Verification Queue")
    r_sub.font.name = "Segoe UI"
    r_sub.font.size = Pt(10)
    r_sub.font.color.rgb = MUTED

    # Helper functions
    def add_heading(title):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(4)
        run = p.add_run(title)
        run.font.name = "Segoe UI"
        run.font.size = Pt(12)
        run.font.bold = True
        run.font.color.rgb = PRIMARY
        return p

    def add_point(bold_prefix, text):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_before = Pt(1)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.15
        r1 = p.add_run(bold_prefix)
        r1.font.name = "Segoe UI"
        r1.font.size = Pt(9.5)
        r1.font.bold = True
        r1.font.color.rgb = PRIMARY
        r2 = p.add_run(text)
        r2.font.name = "Segoe UI"
        r2.font.size = Pt(9.5)
        r2.font.color.rgb = TEXT
        return p

    # Section 1: SRF Changes
    add_heading("1. Student Registration Form (SRF) — Board Grading & Usability")
    add_point("Cambridge & Other Boards: ", "Grade field is mandatory (e.g. A*, A, B, 7). Marks percentage is optional.")
    add_point("Standard Boards (CBSE / State / CISCE): ", "Marks percentage remains strictly mandatory (0–100%). Grade field is hidden.")
    add_point("Board Name (Other): ", "When 'Other' is selected, entering the official board name remains required.")
    add_point("Cumulative Arrear History & Inline Errors: ", "Inline validation error messages are now rendered under Standing Arrears and Arrear History. The hint explicitly clarifies that Arrear History is cumulative across the degree up to that semester.")
    add_point("Non-Decreasing Arrear History Validation: ", "The system now validates across semesters that arrear history cannot decrease (e.g., entering 2 in Semester 1 and 1 in Semester 2 is prevented with a clear explanation).")
    add_point("Step Completion Checkmarks (✓): ", "Top navigation pills now dynamically display a checkmark (e.g. '1. Personal Details ✓') as soon as required fields in that section are filled.")
    add_point("Smart Mobile Number Sanitization: ", "Pasting phone numbers with country codes (+91, 91), leading zeros, spaces, or hyphens is automatically sanitized to 10 clean digits to prevent validation blocks.")
    add_point("Submission Error Focus & Alert: ", "If required fields are missed on submit, an alert banner appears above the submit button and the page automatically scrolls to and focuses on the first invalid field.")

    # Section 2: Coordinator Verification Queue
    add_heading("2. Coordinator Verification Queue (/cpc/verification)")
    add_point("Grade Display for International Boards: ", "The 10th and 12th marks columns now display letter/scale grades (e.g. 'Grade: A*' or '91.4% (Grade: A*)') so coordinators can verify Cambridge/Other statements of results.")
    add_point("Arrear History Consistency (2 vs 1 Fix): ", "The 'Arrear history' summary column now correctly evaluates the maximum cumulative arrear history across all declared semesters, eliminating discrepancies where a student who declared 2 arrears was displayed with 1.")
    add_point("Standing Arrears Display & Auto-Sync: ", "The Standing Arrears column accurately reflects the student's declared arrears from their latest semester, automatically synchronized into the student record upon submission.")
    add_point("School Marksheets Only: ", "The School Marksheets column displays only qualification marksheets (10th, 12th, Diploma, UG Consolidated). Certificates and resumes are kept in their own designated columns.")
    add_point("Single Latest Scan: ", "If a student uploads a revised marksheet, only the latest active scan is shown. Stale duplicate links from previous attempts are filtered out.")
    add_point("Label-Based File Display: ", "Documents appear as clean, clear labels ('10th marksheet', '12th marksheet', 'Diploma marksheet') rather than raw file names or storage paths.")
    add_point("Certificate Names + Files: ", "In the Certificates column, both the declared certificate name and original file name are clearly shown: e.g. AWS Cloud Practitioner (aws_cert.pdf).")
    add_point("Missing Documents Warning: ", "If a file is missing, an explicit warning badge ('None uploaded' / 'No marksheet') appears instead of dead links.")
    add_point("Add Semester Arrears Guard: ", "The subsequent semester submission form now validates that standing and historical arrears are valid non-negative whole numbers and that history is not lower than standing arrears.")
    add_point("Re-Verification Workflow: ", "Approved or rejected student records can be reset back to 'srf_submitted' (with semesters and certificates reset to 'pending') for complete re-verification.")

    # Section 3: Summary Table
    add_heading("3. Quick Comparison: Before vs. After")

    table_data = [
        ("Feature", "Before (Problem)", "Now (Simple & Clean)"),
        ("Cambridge Board", "Mandatory 0–100% percentage. No grade field.", "Grade is mandatory (A*, A, B). Percentage is optional."),
        ("Other Board", "Mandatory 0–100% percentage. No grade field.", "Grade is mandatory. Board name required. % is optional."),
        ("Standard Boards", "Mandatory percentage (0–100%).", "Unchanged. Percentage remains mandatory (0–100%)."),
        ("Verification Grades", "Only percentages displayed; Cambridge grades invisible.", "Displays letter grade (e.g. Grade: A*) alongside or in place of %."),
        ("Arrear History Count", "Queue showed 1 arrear history when student entered 2 across semesters.", "Queue accurately evaluates cumulative arrear history (2) across all semesters."),
        ("Arrears Field Errors", "No error text under Standing or History of Arrears inputs.", "Inline error text displayed directly beneath each arrears field."),
        ("Arrear History Consistency", "Form allowed arrear history to drop in later semesters.", "Strict cross-semester check prevents arrear history from decreasing."),
        ("Standing Arrears", "Queue showed 0 arrears despite semester declaration.", "Accurately displays standing arrears synced from latest semester."),
        ("Step Navigation", "Numbered pills gave no indication of completed sections.", "Displays ✓ checkmark on completed steps (e.g. 1. Personal Details ✓)."),
        ("Mobile Validation", "Failed validation on +91, spaces, or hyphens.", "Automatically strips +91, spaces, and hyphens to 10 digits."),
        ("Submission Errors", "Silent validation block or confusion on missed fields.", "Shows red alert banner and smoothly scrolls to first invalid field."),
        ("School Marksheets Column", "Cluttered with certificates, resumes, and offer letters.", "Shows strictly school marksheets (10th, 12th, Diploma, UG)."),
        ("Resubmitted Scans", "Showed duplicate old links for every re-upload.", "Deduplicated: shows only the single latest active scan."),
        ("Document Links", "Raw storage names / inconsistent tags.", "Standardized labels: '10th marksheet', '12th marksheet'."),
        ("Certificates Display", "Generic label without file context.", "Shows Certificate Name + Original File Name."),
        ("Re-Verification", "Approved records locked without queue re-entry.", "Resetting status returns record to queue for full coordinator re-check.")
    ]

    t = doc.add_table(rows=len(table_data), cols=3)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_borders(t)

    col_widths = [Inches(1.8), Inches(2.5), Inches(2.5)]

    for r_idx, row in enumerate(table_data):
        is_hdr = (r_idx == 0)
        bg = "3D3777" if is_hdr else ("F8FAFC" if r_idx % 2 == 1 else "FFFFFF")

        for c_idx, text in enumerate(row):
            cell = t.rows[r_idx].cells[c_idx]
            cell.width = col_widths[c_idx]
            set_cell_background(cell, bg)
            set_cell_margins(cell, top=60, bottom=60, left=80, right=80)

            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.1

            run = p.add_run(text)
            run.font.name = "Segoe UI"
            if is_hdr:
                run.font.size = Pt(8.5)
                run.font.bold = True
                run.font.color.rgb = RGBColor(255, 255, 255)
            else:
                run.font.size = Pt(8.5)
                if c_idx == 0:
                    run.font.bold = True
                    run.font.color.rgb = PRIMARY
                else:
                    run.font.color.rgb = TEXT

    # Save
    doc.save(str(output_path))
    print(f"Successfully generated clean docx at {output_path}")

if __name__ == "__main__":
    out_file = Path("docs/USER_MANUAL_CHANGES.docx")
    build_simple_user_manual_changes_docx(out_file)
