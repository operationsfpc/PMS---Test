import os
import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:val="clear" w:color="auto" w:fill="{hex_color}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'''
        <w:tcMar {nsdecls("w")}>
            <w:top w:w="{top}" w:type="dxa"/>
            <w:bottom w:w="{bottom}" w:type="dxa"/>
            <w:left w:w="{left}" w:type="dxa"/>
            <w:right w:w="{right}" w:type="dxa"/>
        </w:tcMar>
    ''')
    tcPr.append(tcMar)

def create_catalog_docx(output_path):
    doc = Document()

    # Set page margins (0.75 in)
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)

    # Styles & Brand Colors
    # Primary: #3D3777, Amber: #FFB800, Dark Neutral: #222222, Light Neutral: #F4F5F7
    COLOR_PRIMARY = RGBColor(61, 55, 119)     # #3D3777
    COLOR_SECONDARY = RGBColor(217, 119, 6)   # Amber dark #D97706
    COLOR_TEXT = RGBColor(34, 34, 34)         # #222222
    COLOR_MUTED = RGBColor(100, 116, 139)     # #64748B

    # Document Title
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(0)
    title_p.paragraph_format.space_after = Pt(4)
    run_brand = title_p.add_run("FACE Prep Campus\n")
    run_brand.font.name = "Segoe UI"
    run_brand.font.size = Pt(14)
    run_brand.font.bold = True
    run_brand.font.color.rgb = COLOR_SECONDARY

    run_title = title_p.add_run("Email Notification & Message Catalog")
    run_title.font.name = "Segoe UI"
    run_title.font.size = Pt(24)
    run_title.font.bold = True
    run_title.font.color.rgb = COLOR_PRIMARY

    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_after = Pt(16)
    run_sub = sub_p.add_run("Complete specification of triggers, recipient groups, exact subject lines, full message templates, dynamic variables, and Call-to-Action (CTA) links across the Placement Management System (PMS).")
    run_sub.font.name = "Segoe UI"
    run_sub.font.size = Pt(10.5)
    run_sub.font.color.rgb = COLOR_MUTED

    # Global Standards Callout Box
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    cell.width = Inches(7.0)
    set_cell_background(cell, "ECEEF8")
    set_cell_margins(cell, top=140, bottom=140, left=180, right=180)

    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run("GLOBAL SENDER STANDARDS & EXECUTIVE UI DESIGN SYSTEM")
    r.font.name = "Segoe UI"
    r.font.size = Pt(10)
    r.font.bold = True
    r.font.color.rgb = COLOR_PRIMARY

    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(2)
    p2.add_run("• Official Logo Header: ").font.bold = True
    p2.add_run("FACE Prep Campus light logo (faceprep-campus-light.png) rendered on Deep Indigo (#3D3777) header with gold 'OFFICIAL NOTICE' pill badge.\n")
    p2.add_run("• Top Brand Stripe: ").font.bold = True
    p2.add_run("Vibrant multi-color gradient (Indigo #3D3777 → Violet #A46AFC → Amber #FFB800) for instant brand recognition.\n")
    p2.add_run("• Content Containers: ").font.bold = True
    p2.add_run("Soft surface cards (#F8FAFC) with 1px border (#E2E8F0) and 4px Indigo left accent stripe.\n")
    p2.add_run("• Primary CTA Button: ").font.bold = True
    p2.add_run("Solid Indigo (#3D3777) rounded button with bold white typography and right arrow navigation.\n")
    p2.add_run("• Production From: ").font.bold = True
    p2.add_run("FACE Prep Campus <placements@email.faceprep.in> (or placements@faceprepcampus.com)\n")
    p2.add_run("• Reply-To Address: ").font.bold = True
    p2.add_run("placements@faceprep.in (Official Google Workspace Mailbox)\n")
    p2.add_run("• Safety Test Routing: ").font.bold = True
    p2.add_run("All development test dispatches are routed safely to operationsfpc@faceprep.in.\n")
    p2.add_run("• Opt-Out Rule: ").font.bold = True
    p2.add_run("Students marked participation_status = 'opted_out' are strictly excluded from all drive mailings.")
    for r_item in p2.runs:
        r_item.font.name = "Segoe UI"
        r_item.font.size = Pt(9.5)


    doc.add_paragraph().paragraph_format.space_after = Pt(8)

    # Helper function for Section Headers
    def add_section_header(text, subtitle=None):
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(18)
        h.paragraph_format.space_after = Pt(4)
        run = h.add_run(text)
        run.font.name = "Segoe UI"
        run.font.size = Pt(16)
        run.font.bold = True
        run.font.color.rgb = COLOR_PRIMARY

        if subtitle:
            sub = doc.add_paragraph()
            sub.paragraph_format.space_after = Pt(10)
            r_sub = sub.add_run(subtitle)
            r_sub.font.name = "Segoe UI"
            r_sub.font.size = Pt(10)
            r_sub.font.italic = True
            r_sub.font.color.rgb = COLOR_MUTED

    # Helper function for Email Items
    def add_email_item(code, title, trigger, screen, recipient, subject, body_lines, cta_text, cta_url, note=None):
        h = doc.add_paragraph()
        h.paragraph_format.space_before = Pt(12)
        h.paragraph_format.space_after = Pt(4)
        r_code = h.add_run(f"[{code}] ")
        r_code.font.bold = True
        r_code.font.color.rgb = COLOR_SECONDARY
        r_title = h.add_run(title)
        r_title.font.name = "Segoe UI"
        r_title.font.size = Pt(13)
        r_title.font.bold = True
        r_title.font.color.rgb = COLOR_PRIMARY

        # Meta table (Trigger, Screen, Recipient, Subject)
        t = doc.add_table(rows=4, cols=2)
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        cols_w = [Inches(1.5), Inches(5.5)]
        
        meta = [
            ("Trigger Event:", trigger),
            ("Source Screen:", screen),
            ("Recipient (To):", recipient),
            ("Subject Line:", subject)
        ]
        for row_idx, (label, val) in enumerate(meta):
            row = t.rows[row_idx]
            cell_lbl, cell_val = row.cells[0], row.cells[1]
            cell_lbl.width, cell_val.width = cols_w[0], cols_w[1]
            set_cell_background(cell_lbl, "F8FAFC")
            set_cell_background(cell_val, "FFFFFF")
            set_cell_margins(cell_lbl, 40, 40, 80, 80)
            set_cell_margins(cell_val, 40, 40, 80, 80)

            p_lbl = cell_lbl.paragraphs[0]
            p_lbl.paragraph_format.space_after = Pt(0)
            r_l = p_lbl.add_run(label)
            r_l.font.name = "Segoe UI"
            r_l.font.size = Pt(9)
            r_l.font.bold = True
            r_l.font.color.rgb = COLOR_PRIMARY

            p_val = cell_val.paragraphs[0]
            p_val.paragraph_format.space_after = Pt(0)
            r_v = p_val.add_run(val)
            r_v.font.name = "Segoe UI"
            r_v.font.size = Pt(9)
            r_v.font.color.rgb = COLOR_TEXT
            if label == "Subject Line:":
                r_v.font.bold = True

        doc.add_paragraph().paragraph_format.space_after = Pt(2)

        # Message Preview Box
        msg_table = doc.add_table(rows=1, cols=1)
        msg_table.alignment = WD_TABLE_ALIGNMENT.CENTER
        msg_cell = msg_table.cell(0, 0)
        msg_cell.width = Inches(7.0)
        set_cell_background(msg_cell, "FAFAFA")
        set_cell_margins(msg_cell, top=100, bottom=100, left=140, right=140)

        p_prev = msg_cell.paragraphs[0]
        p_prev.paragraph_format.space_after = Pt(4)
        r_p = p_prev.add_run("EMAIL BODY CONTENT & TEMPLATE:")
        r_p.font.name = "Segoe UI"
        r_p.font.size = Pt(8.5)
        r_p.font.bold = True
        r_p.font.color.rgb = COLOR_MUTED

        for line in body_lines:
            p_line = msg_cell.add_paragraph()
            p_line.paragraph_format.space_after = Pt(2)
            r_line = p_line.add_run(line)
            r_line.font.name = "Consolas" if line.startswith("•") or line.startswith("=") else "Segoe UI"
            r_line.font.size = Pt(9)
            r_line.font.color.rgb = COLOR_TEXT

        # CTA Button inside box
        if cta_text:
            p_cta = msg_cell.add_paragraph()
            p_cta.paragraph_format.space_before = Pt(6)
            p_cta.paragraph_format.space_after = Pt(2)
            r_btn = p_cta.add_run(f" [ CTA BUTTON: {cta_text} ] ")
            r_btn.font.name = "Segoe UI"
            r_btn.font.size = Pt(9)
            r_btn.font.bold = True
            r_btn.font.color.rgb = RGBColor(255, 255, 255)
            # Add highlight/background simulation for button
            r_url = p_cta.add_run(f"  →  {cta_url}")
            r_url.font.name = "Consolas"
            r_url.font.size = Pt(8.5)
            r_url.font.color.rgb = COLOR_SECONDARY

        if note:
            p_n = msg_cell.add_paragraph()
            p_n.paragraph_format.space_before = Pt(4)
            p_n.paragraph_format.space_after = Pt(0)
            r_n = p_n.add_run(f"Note: {note}")
            r_n.font.name = "Segoe UI"
            r_n.font.size = Pt(8.5)
            r_n.font.italic = True
            r_n.font.color.rgb = COLOR_MUTED

        doc.add_paragraph().paragraph_format.space_after = Pt(6)

    # -------------------------------------------------------------
    # SECTION 1: STUDENT COMMUNICATIONS
    # -------------------------------------------------------------
    add_section_header("1. Student Communications", "Direct notifications sent to placement candidates (students.email). Opted-out students are automatically filtered out.")

    add_email_item(
        code="S1",
        title="Student Roster Welcome & SRF Registration Invite",
        trigger="Admin uploads college student roster (.csv / .xlsx) creating student rows with status 'invited'.",
        screen="/admin/roster",
        recipient="Student's institutional email address (students.email)",
        subject="Welcome to FACE Prep Campus Placements — Complete Your Profile",
        body_lines=[
            "Dear {full_name},",
            "Your placement account for {campus_name} is now active on the FACE Prep Campus Placement Management System (PMS).",
            "To participate in upcoming campus placement and internship drives, you must complete and submit your Student Registration Form (SRF). This includes verifying your academic records and uploading your semester marksheets.",
            "Your Details on Record:",
            "• Roll Number: {roll_number}",
            "• Degree & Branch: {degree} — {branch}",
            "• Passing Year: {passing_year}",
            "Please sign in using your registered Google account ({email}) and complete your profile before the registration deadline."
        ],
        cta_text="Complete Registration Form",
        cta_url="https://faceprepcampus.com/student/srf",
        note="Students with incomplete profiles cannot apply for live placement drives once registration closes."
    )

    add_email_item(
        code="S2",
        title="Placement Drive Published / Announced",
        trigger="Central Placement Coordinator (CPC) finalises targeting criteria and publishes an approved drive live.",
        screen="/central/publish?drive={drive_id}",
        recipient="All eligible active students matching targeted campuses, degrees, branches, passing year, and academic cutoffs.",
        subject="New Drive: {company_name} is hiring for {role_title}",
        body_lines=[
            "Dear {full_name},",
            "A new placement drive has been announced for your cohort:",
            "==================================================",
            "Company:         {company_name}",
            "Role:            {role_title}",
            "Drive Type:      {drive_type} (Placement / Internship)",
            "Category:        {offer_category} (Regular / Dream / Super Dream / Internship)",
            "Compensation:    {ctc_lpa} LPA {stipend_text}",
            "Application Due: {application_end_datetime_ist}",
            "==================================================",
            "Eligibility Criteria:",
            "• Minimum CGPA: {min_cgpa}",
            "• Maximum Backlogs: {max_arrears}",
            "• Targeted Campuses: {campuses_list}",
            "Please review the job description, bond terms, and shift requirements carefully before applying."
        ],
        cta_text="View Drive & Apply",
        cta_url="https://faceprepcampus.com/student/drives/{drive_id}"
    )

    add_email_item(
        code="S3",
        title="Round 1 Shortlist Announcement",
        trigger="Central CPC completes candidate shortlisting and saves the shortlist entries (database trigger shortlist_reaches_student).",
        screen="/central/shortlist?drive={drive_id}",
        recipient="Shortlisted students (shortlist_entries.included = true)",
        subject="Shortlisted: You are shortlisted for {company_name}",
        body_lines=[
            "Dear {full_name},",
            "Congratulations! You have been shortlisted for the {company_name} placement drive ({role_title}).",
            "Round 1 is next. You are expected to attend every scheduled round for this drive. Details regarding date, time, and venue/meeting links will follow shortly.",
            "Drive Summary:",
            "• Company: {company_name}",
            "• Role: {role_title}",
            "• Drive Type: {drive_type}"
        ],
        cta_text="View Application Status",
        cta_url="https://faceprepcampus.com/student/drives/{drive_id}",
        note="Failure to attend scheduled rounds without prior approved permission may lead to placement disbarment review."
    )

    add_email_item(
        code="S4",
        title="Round Schedule & Venue Announcement",
        trigger="Coordinator updates round date, time, venue address, mode (online/offline), or test link (database trigger round_details_reach_students).",
        screen="/central/rounds?drive={drive_id}",
        recipient="All students scheduled/participating in that round.",
        subject="{company_name} — {round_name} Schedule & Details",
        body_lines=[
            "Dear {full_name},",
            "The schedule for {round_name} of {company_name} has been published:",
            "• Round:        {round_name} (Round {sequence})",
            "• Date & Time:  {round_datetime_ist} IST",
            "• Mode:         {round_mode} (Online / Physical / Hybrid)",
            "• Venue / Link: {venue_or_meeting_details}",
            "• Instructions: {round_instructions}",
            "Please arrive at the venue 15 minutes before the scheduled time or join the virtual room promptly with your full name and roll number."
        ],
        cta_text="View Drive Dashboard",
        cta_url="https://faceprepcampus.com/student/drives/{drive_id}"
    )

    add_email_item(
        code="S5",
        title="Personal Interview Slot & Meeting Link",
        trigger="Coordinator assigns a personalized 1-on-1 interview time or dedicated meeting link (database trigger meeting_slot_reaches_student).",
        screen="/central/rounds?drive={drive_id} (Slot assignment panel)",
        recipient="The individual scheduled student.",
        subject="{company_name} — Your {round_name} Interview Slot",
        body_lines=[
            "Dear {full_name},",
            "Your individual interview slot for {round_name} of {company_name} has been scheduled:",
            "• Date & Time:  {participant_scheduled_at_ist} IST",
            "• Meeting Link: {meeting_link}",
            "• Round:        {round_name}",
            "Please join the link 5 minutes prior to your time slot. Have a soft copy of your resume and college ID card ready."
        ],
        cta_text="Join Interview Room",
        cta_url="{meeting_link}"
    )

    add_email_item(
        code="S6",
        title="Round Cleared / Selected Announcement",
        trigger="Coordinator marks student's outcome as 'selected' for a round (database trigger round_result_reaches_student).",
        screen="/central/results?drive={drive_id}&round={round_id}",
        recipient="Students who cleared the round.",
        subject="Well done — You cleared Round {sequence} of {company_name}",
        body_lines=[
            "Dear {full_name},",
            "Great news! You have successfully cleared Round {sequence} ({round_name}) of the {company_name} placement drive.",
            "You are advancing to the next round. The schedule and details for the upcoming round will be shared shortly on your student dashboard.",
            "Keep up the great performance!"
        ],
        cta_text="View Drive Progress",
        cta_url="https://faceprepcampus.com/student/drives/{drive_id}"
    )

    add_email_item(
        code="S7",
        title="Round Outcome — Not Selected",
        trigger="Coordinator marks student's outcome as 'rejected' for a round (database trigger round_result_reaches_student).",
        screen="/central/results?drive={drive_id}&round={round_id}",
        recipient="Students not selected in that round.",
        subject="{company_name} — Round {sequence} Update",
        body_lines=[
            "Dear {full_name},",
            "Thank you for participating in Round {sequence} ({round_name}) of the {company_name} placement drive.",
            "The evaluation process has concluded, and you were not selected to advance further in this particular drive.",
            "Every selection process is competitive and offers valuable experience. Your placement status remains active for upcoming companies matching your profile. Please keep checking your dashboard for new drive announcements."
        ],
        cta_text="Explore Open Drives",
        cta_url="https://faceprepcampus.com/student/drives"
    )

    add_email_item(
        code="S8",
        title="Job / Internship Offer Letter Declared",
        trigger="Coordinator records an on-campus offer in the results console (database trigger offer_reaches_student).",
        screen="/central/results?drive={drive_id}&round={round_id}",
        recipient="Placed candidate (offers.student_id)",
        subject="Congratulations — Offer from {company_name} ({offer_category_label})!",
        body_lines=[
            "Dear {full_name},",
            "Heartiest congratulations!",
            "{company_name} has formally extended you an offer for the position of {role_title}.",
            "Offer Details:",
            "• Company:        {company_name}",
            "• Role:           {role_title}",
            "• Offer Category: {offer_category_label} (Regular / Dream / Super Dream / Internship)",
            "• Compensation:   ₹{ctc_lpa} LPA {stipend_text}",
            "• Date Declared:  {declared_at_formatted}",
            "Your official offer letter has been uploaded to your PMS portal. This is a testament to your hard work and dedication. We wish you immense success in your professional career!"
        ],
        cta_text="View Offer & Download Letter",
        cta_url="https://faceprepcampus.com/student/notifications"
    )

    add_email_item(
        code="S9",
        title="Attendance Warning — Marked Absent",
        trigger="Coordinator marks student as 'absent' during round attendance tracking (database trigger notify_absent_student).",
        screen="/central/results or attendance marking",
        recipient="The absent student.",
        subject="Urgent: Attendance Notice for {company_name}",
        body_lines=[
            "Dear {full_name},",
            "You were recorded as ABSENT for {round_name} of the {company_name} placement drive held on {scheduled_date}.",
            "Under placement policy guidelines:",
            "• Attendance in all scheduled rounds is mandatory once shortlisted.",
            "• Unexcused absences across drives are audited and accumulated.",
            "• Repeated absences lead to immediate review and potential disbarment from future campus drives.",
            "If you believe this record is an error or had an approved medical/emergency exemption, please contact your Campus Placement Coordinator immediately."
        ],
        cta_text="Contact Placement Coordinator",
        cta_url="https://faceprepcampus.com/student/dashboard"
    )

    # -------------------------------------------------------------
    # SECTION 2: STAFF COMMUNICATIONS
    # -------------------------------------------------------------
    add_section_header("2. Staff & Administrative Communications", "Internal notifications sent to staff members, coordinators, account executives, and delivery heads.")

    add_email_item(
        code="M1",
        title="Staff Role Invitation & Onboarding",
        trigger="Admin invites a new staff member with an assigned role and campus mapping.",
        screen="/admin/staff",
        recipient="Invited staff member's email (staff_invitations.email)",
        subject="Invitation to FACE Prep Campus PMS as {role_display_name}",
        body_lines=[
            "Hello {full_name},",
            "You have been invited to join the FACE Prep Campus Placement Management System (PMS) as:",
            "• Role:               {role_display_name}",
            "• Assigned Campus(es):{campuses_assigned_list}",
            "• Invited By:         {inviter_email}",
            "Your PMS account allows you to manage drives, verify student credentials, and oversee placement operations according to your role permissions.",
            "To access your account, click below and sign in using your Google account ({email})."
        ],
        cta_text="Sign In to PMS",
        cta_url="https://faceprepcampus.com/login"
    )

    add_email_item(
        code="M2",
        title="AE Deal Intake / PIF Submitted for Approval",
        trigger="Account Executive (AE) submits a Placement Initiation Form (PIF) or incoming deal intake.",
        screen="/ae/drives/new or /ae/drives/{id}",
        recipient="Delivery Head (profiles with delivery_head role)",
        subject="Action Required: PIF Submitted for {company_name} by {ae_name}",
        body_lines=[
            "Dear Delivery Head,",
            "A new Placement Initiation Form (PIF) has been submitted and is waiting for your review and classification:",
            "• Company:         {company_name}",
            "• Role:            {role_title}",
            "• Drive Type:      {drive_type}",
            "• Declared CTC:    ₹{ctc_lpa} LPA",
            "• Submitted By AE: {ae_name} ({ae_email})",
            "Please review the recruiter contacts, compensation terms, and job description, assign the official Offer Category, and approve or reject the drive."
        ],
        cta_text="Open PIF Review Queue",
        cta_url="https://faceprepcampus.com/delivery-head/queue"
    )

    add_email_item(
        code="M3",
        title="PIF Approved — Ready for Drive Scheduling & Publish",
        trigger="Delivery Head approves the PIF and assigns the CTC classification band.",
        screen="/delivery-head/queue",
        recipient="Central Placement Coordinators (profiles with central_placement_coordinator role)",
        subject="Drive Approved: {company_name} — Ready for Round Setup & Publishing",
        body_lines=[
            "Dear Central Placement Coordinator,",
            "The Placement Initiation Form (PIF) for {company_name} ({role_title}) has been approved by the Delivery Head:",
            "• Company:        {company_name}",
            "• Role:           {role_title}",
            "• Offer Category: {offer_category_label}",
            "• CTC / Stipend:  ₹{ctc_lpa} LPA {stipend_text}",
            "• Approved By:    {approver_name}",
            "You may now configure the drive rounds, verify campus targeting, and publish the drive live to students."
        ],
        cta_text="Configure & Publish Drive",
        cta_url="https://faceprepcampus.com/central/publish?drive={drive_id}"
    )

    # -------------------------------------------------------------
    # SECTION 3: RECRUITER COMMUNICATIONS
    # -------------------------------------------------------------
    add_section_header("3. Recruiter Communications", "External exports sent to company recruitment SPOCs.")

    add_email_item(
        code="R1",
        title="Shortlist & Candidate Resumes Export Pack",
        trigger="Central Placement Coordinator generates and dispatches the verified shortlist pack.",
        screen="/central/shortlist?drive={drive_id} (Recruiter Export action)",
        recipient="Recruiter SPOC contacts listed in the drive (drives.contacts[].email)",
        subject="Candidate Shortlist & Resume Pack — {company_name} Drive | FACE Prep Campus",
        body_lines=[
            "Dear {contact_name},",
            "Thank you for partnering with FACE Prep Campus for your {passing_year} recruitment drive.",
            "Please find attached the official candidate shortlist for the {role_title} opportunity:",
            "• Total Shortlisted Candidates: {shortlisted_count}",
            "• Partner Campuses:             {participating_campuses}",
            "The attached export package contains:",
            "1. Candidate Manifest Spreadsheet (.xlsx) with verified CGPA, branch, skill ratings, and contact details.",
            "2. Verified Candidate Resume Pack (.zip containing verified PDF resumes).",
            "Our coordinator team is ready to assist with scheduling Round 1 evaluations and technical assessments.",
            "Coordinator Contact: {cpc_name} ({cpc_email}, {cpc_phone})"
        ],
        cta_text=None,
        cta_url=None,
        note="Includes .xlsx spreadsheet and .zip resume attachments."
    )

    # -------------------------------------------------------------
    # SECTION 4: SUMMARY MATRIX TABLE
    # -------------------------------------------------------------
    add_section_header("4. Summary Matrix: Trigger & Recipient Reference")

    matrix_data = [
        ("S1", "Welcome / SRF Invite", "Roster Import", "students.email", "Resend Send"),
        ("S2", "Drive Published", "Publish Screen", "Targeted students.email", "Resend Batch"),
        ("S3", "Shortlisted", "Shortlist Screen", "students.email", "Deliveries Queue"),
        ("S4", "Round Scheduled", "Rounds Screen", "Participating students.email", "Deliveries Queue"),
        ("S5", "Meeting Slot Assigned", "Rounds Screen", "Scheduled student.email", "Deliveries Queue"),
        ("S6", "Round Selected", "Results Screen", "Selected students.email", "Deliveries Queue"),
        ("S7", "Round Rejected", "Results Screen", "Rejected students.email", "Deliveries Queue"),
        ("S8", "Offer Declared", "Results Screen", "Placed students.email", "Deliveries Queue"),
        ("S9", "Absent Marked", "Results Screen", "Absent students.email", "Deliveries Queue"),
        ("M1", "Staff Onboarding", "Staff Screen", "staff_invitations.email", "Resend Send"),
        ("M2", "PIF Submitted", "AE Screen", "Delivery Head email", "Resend Send"),
        ("M3", "Drive Approved", "DH Queue", "Central CPC email", "Resend Send"),
        ("R1", "Shortlist & Resumes", "Shortlist Screen", "drives.contacts[].email", "Resend Attachment"),
    ]

    t_mat = doc.add_table(rows=len(matrix_data) + 1, cols=5)
    t_mat.alignment = WD_TABLE_ALIGNMENT.CENTER
    headers = ["Code", "Event / Notice", "Trigger Source", "Recipient Field", "Mechanism"]
    w_mat = [Inches(0.6), Inches(1.8), Inches(1.4), Inches(1.8), Inches(1.4)]

    # Header Row
    for idx, name in enumerate(headers):
        cell = t_mat.rows[0].cells[idx]
        cell.width = w_mat[idx]
        set_cell_background(cell, "3D3777")
        set_cell_margins(cell, 60, 60, 60, 60)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(name)
        r.font.name = "Segoe UI"
        r.font.size = Pt(8.5)
        r.font.bold = True
        r.font.color.rgb = RGBColor(255, 255, 255)

    # Data Rows
    for r_idx, row_vals in enumerate(matrix_data):
        row = t_mat.rows[r_idx + 1]
        bg = "F8FAFC" if r_idx % 2 == 1 else "FFFFFF"
        for c_idx, val in enumerate(row_vals):
            cell = row.cells[c_idx]
            cell.width = w_mat[c_idx]
            set_cell_background(cell, bg)
            set_cell_margins(cell, 40, 40, 60, 60)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            r = p.add_run(val)
            r.font.name = "Segoe UI"
            r.font.size = Pt(8.5)
            r.font.color.rgb = COLOR_TEXT
            if c_idx == 0:
                r.font.bold = True
                r.font.color.rgb = COLOR_PRIMARY

    # Save document
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    doc.save(output_path)
    print(f"Successfully generated DOCX at: {output_path}")

if __name__ == "__main__":
    primary = os.path.abspath("docs/FACE_Prep_PMS_Email_Notification_Catalog.docx")
    specs_copy = os.path.abspath("docs/specs/2026-09-04-email-notification-catalog.docx")
    v2_copy = os.path.abspath("docs/FACE_Prep_PMS_Email_Notification_Catalog_v2.docx")

    # Save to specs copy
    create_catalog_docx(specs_copy)

    # Save to primary (or v2 if user has primary open in Word)
    try:
        create_catalog_docx(primary)
    except PermissionError:
        print(f"Primary file is currently open in Microsoft Word. Saving to: {v2_copy}")
        create_catalog_docx(v2_copy)

