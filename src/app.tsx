import { AppShell } from "@components/app-shell";
import { RoleGuard } from "@components/role-guard";
import {
  canAccessAdmin,
  canAccessCampusCpc,
  canAccessCentral,
  canAccessPifApproval,
  canAccessPifCreation,
  canAccessPublish,
  canAccessShortlisting,
  canViewDriveProgress,
} from "@domain/route-access";
import { AdminCampusRoute } from "@features/admin/campus-route";
import { AdminRosterPage } from "@features/admin/roster-page";
import { AdminStaffRoute } from "@features/admin/staff-route";
import { AeOverviewRoute } from "@features/ae/overview-route";
import { LoginPage } from "@features/auth/login-page";
import { RequireAuth } from "@features/auth/require-auth";
import { RoleLanding } from "@features/auth/role-landing";
import { CockpitRoute } from "@features/central-cpc/cockpit-route";
import { OfferRoute } from "@features/central-cpc/offer-route";
import { PublishRoute } from "@features/central-cpc/publish-route";
import { ResultsRoute } from "@features/central-cpc/results-route";
import { ShortlistRoute } from "@features/central-cpc/shortlist-route";
import { SkillsAssessedRoute } from "@features/central-cpc/skills-assessed-route";
import { SkillsRoute } from "@features/central-cpc/skills-route";
import { StudentDirectoryRoute } from "@features/central-cpc/students-route";
import { AttendanceRoute } from "@features/cpc/attendance-route";
import { CertificateQueue } from "@features/cpc/certificate-queue";
import { DriveProgressRoute } from "@features/cpc/drive-progress-route";
import { OffCampusQueueRoute, OptOutQueueRoute } from "@features/cpc/participation-queue-routes";
import { SemesterQueue } from "@features/cpc/semester-queue";
import { SrfVerificationQueue } from "@features/cpc/srf-verification-queue";
import { DashboardRoute } from "@features/dashboard/dashboard-route";
import { PifApprovalQueue } from "@features/delivery-head/pif-approval-queue";
import { DrivePortfolioRoute } from "@features/drive-portfolio/portfolio-route";
import { DriveRecordRoute } from "@features/drive-record/record-route";
import { PifPage } from "@features/pif/pif-page";
import { SrfRoute } from "@features/srf/srf-route";
import { StudentDrivesPage } from "@features/student/drives-page";
import { StudentOffCampusRoute, StudentOptOutRoute } from "@features/student/participation-routes";
import { StudentProfileRoute } from "@features/student/profile-route";
import {
  StudentDashboardRoute,
  StudentNotificationsRoute,
} from "@features/student/student-dashboard-route";
import { StudentRecordRoute } from "@features/student-record/student-record-route";
import { Route, Routes } from "react-router";

export function App() {
  return (
    <Routes>
      {/* The only public route. Everything else is behind RequireAuth. */}
      <Route path="/login" element={<LoginPage />} />

      {/* The SRF is full-bleed: it has its own focused chrome. */}
      <Route
        path="/srf"
        element={
          <RequireAuth>
            <SrfRoute />
          </RequireAuth>
        }
      />

      <Route
        path="*"
        element={
          <RequireAuth>
            <AppShell>
              <Routes>
                {/* Post-login routing is a domain rule, not a hardcoded path. */}
                <Route path="/" element={<RoleLanding />} />
                <Route path="/dashboard" element={<DashboardRoute />} />
                <Route
                  path="/admin/campuses"
                  element={
                    <RoleGuard allow={canAccessAdmin} reason="Organisation setup is for administrators only. Campus staff manage their campus under /cpc.">
                      <AdminCampusRoute />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/admin/staff"
                  element={
                    <RoleGuard allow={canAccessAdmin} reason="Organisation setup is for administrators only. Campus staff manage their campus under /cpc.">
                      <AdminStaffRoute />
                    </RoleGuard>
                  }
                />
                {/* F6: degrees and branches are no longer a page. They belong
                    to a college, for a passing year, under /admin/campuses. */}
                <Route
                  path="/admin/roster"
                  element={
                    <RoleGuard allow={canAccessAdmin} reason="Organisation setup is for administrators only. Campus staff manage their campus under /cpc.">
                      <AdminRosterPage />
                    </RoleGuard>
                  }
                />
                <Route path="/student" element={<StudentDashboardRoute />} />
                <Route path="/student/notifications" element={<StudentNotificationsRoute />} />
                <Route path="/student/drives" element={<StudentDrivesPage />} />
                {/* N1: the one canonical drive page, for every role. */}
                <Route path="/drives/:driveId" element={<DriveRecordRoute />} />
                {/* G7 (UAT 2026-08-20, Q7b): the canonical student record —
                    N1's second canonical page. RLS scopes who reads whom. */}
                <Route path="/students/:studentId" element={<StudentRecordRoute />} />
                {/* F2: two decisions, two heads. */}
                <Route path="/student/opt-out" element={<StudentOptOutRoute />} />
                <Route path="/student/off-campus" element={<StudentOffCampusRoute />} />
                <Route path="/student/profile" element={<StudentProfileRoute />} />
                <Route
                  path="/cpc/verification"
                  element={
                    <RoleGuard allow={canAccessCampusCpc} reason="This queue belongs to the campus placement coordinator. Registration forms and certificates are verified at the campus, not centrally.">
                      <SrfVerificationQueue />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/cpc/attendance"
                  element={
                    <RoleGuard allow={canAccessCampusCpc} reason="This queue belongs to the campus placement coordinator. Registration forms and certificates are verified at the campus, not centrally.">
                      <AttendanceRoute />
                    </RoleGuard>
                  }
                />
                {/* D10: drive progress is visible to every role that follows
                    students through rounds — not only the campus CPC. The
                    sidebar shows this link for eight roles; the guard now
                    agrees instead of blocking seven of them. */}
                <Route
                  path="/cpc/drives"
                  element={
                    <RoleGuard allow={canViewDriveProgress} reason="Drive progress is available to placement coordinators, the delivery head, account executives and leadership.">
                      <DriveProgressRoute />
                    </RoleGuard>
                  }
                />
                {/* 2026-08-06: certificates are verified like a CGPA. */}
                <Route
                  path="/cpc/certificates"
                  element={
                    <RoleGuard allow={canAccessCampusCpc} reason="This queue belongs to the campus placement coordinator. Registration forms and certificates are verified at the campus, not centrally.">
                      <CertificateQueue />
                    </RoleGuard>
                  }
                />
                {/* 2026-08-24: …and a CGPA is finally verified like a
                    certificate. Semesters added after SRF approval. */}
                <Route
                  path="/cpc/semesters"
                  element={
                    <RoleGuard allow={canAccessCampusCpc} reason="This queue belongs to the campus placement coordinator. Registration forms and certificates are verified at the campus, not centrally.">
                      <SemesterQueue />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/cpc/opt-outs"
                  element={
                    <RoleGuard allow={canAccessCampusCpc} reason="This queue belongs to the campus placement coordinator. Registration forms and certificates are verified at the campus, not centrally.">
                      <OptOutQueueRoute />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/cpc/off-campus"
                  element={
                    <RoleGuard allow={canAccessCampusCpc} reason="This queue belongs to the campus placement coordinator. Registration forms and certificates are verified at the campus, not centrally.">
                      <OffCampusQueueRoute />
                    </RoleGuard>
                  }
                />
                {/* 2026-08-26: the AE's landing page. Their own drives and
                    the organisation's aggregate figures (0064) - never the
                    roster dashboard, which they cannot read. */}
                <Route path="/ae/overview" element={<AeOverviewRoute />} />
                <Route
                  path="/ae/pif"
                  element={
                    <RoleGuard allow={canAccessPifCreation} reason="Only an Account Executive raises a drive. They own the recruiter's brief, and keeping that separate from approving and publishing it is what makes each step a real check.">
                      <PifPage />
                    </RoleGuard>
                  }
                />
                <Route path="/my-drives" element={<DrivePortfolioRoute />} />
                <Route
                  path="/delivery-head/pif-approvals"
                  element={
                    <RoleGuard allow={canAccessPifApproval} reason="Approving a drive belongs to the Delivery Head. They check the commercial terms the Account Executive agreed, which is not a check if the same person did both.">
                      <PifApprovalQueue />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/central/shortlisting"
                  element={
                    <RoleGuard allow={canAccessShortlisting} reason="Shortlisting belongs to the placement coordinators. Choosing which students a recruiter sees is their decision — you can follow this drive, and its results, under &quot;My drives&quot;.">
                      <ShortlistRoute />
                    </RoleGuard>
                  }
                />
                {/* PRD §5: the Central Student Skill Repository. */}
                <Route
                  path="/central/skills"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <SkillsRoute />
                    </RoleGuard>
                  }
                />
                {/* 2026-08-24 (1a/2a/3a): the assessed-skills master list. */}
                <Route
                  path="/central/skills-assessed"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <SkillsAssessedRoute />
                    </RoleGuard>
                  }
                />
                {/* Every student in the placement process. Also the
                    destination of the Placed count on the overview. */}
                <Route
                  path="/central/students"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <StudentDirectoryRoute />
                    </RoleGuard>
                  }
                />
                {/*
                 * Three tabs, 2026-08-18: approved = Yet to publish, Live,
                 * Completed. Drafts are gone from this coordinator's screens.
                 *
                 * Yet to publish stays the COCKPIT because it carries the
                 * publish action and the drive ids every other Central CPC
                 * screen needs. Live and Completed are the card design, which
                 * shows what has become of a drive rather than what it is
                 * waiting for.
                 */}
                <Route
                  path="/central/drives/yet-to-publish"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <CockpitRoute filter="yet-to-publish" />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/central/drives/live"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <DrivePortfolioRoute tab="live" />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/central/drives/completed"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <DrivePortfolioRoute tab="completed" />
                    </RoleGuard>
                  }
                />
                {/* Both old links still answer, pointing at what replaced them:
                    /central/drives was the cockpit and /central/drives/published
                    was the list that is now called Live. */}
                <Route
                  path="/central/drives"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <DrivePortfolioRoute tab="live" />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/central/drives/published"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <DrivePortfolioRoute tab="live" />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/central/publish"
                  element={
                    <RoleGuard allow={canAccessPublish} reason="Publishing a drive belongs to the central placement coordinator. Raising and approving a drive is not the same as announcing it to students.">
                      <PublishRoute />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/central/results"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <ResultsRoute />
                    </RoleGuard>
                  }
                />
                <Route
                  path="/central/offers"
                  element={
                    <RoleGuard allow={canAccessCentral} reason="This area is for the central placement coordinator. Campus coordination happens under /cpc, and student views are under /student.">
                      <OfferRoute />
                    </RoleGuard>
                  }
                />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
