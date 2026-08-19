import { AppShell } from "@components/app-shell";
import {
  canApproveDrive,
  canPublishDrive,
  canRaiseDrive,
  canShortlistFromPortfolio,
} from "@domain/drive-portfolio";
import { AdminCampusRoute } from "@features/admin/campus-route";
import { AdminRosterPage } from "@features/admin/roster-page";
import { AdminStaffRoute } from "@features/admin/staff-route";
import { LoginPage } from "@features/auth/login-page";
import { RequireAuth } from "@features/auth/require-auth";
import { RoleLanding } from "@features/auth/role-landing";
import { CockpitRoute } from "@features/central-cpc/cockpit-route";
import { OfferRoute } from "@features/central-cpc/offer-route";
import { PublishRoute } from "@features/central-cpc/publish-route";
import { ResultsRoute } from "@features/central-cpc/results-route";
import { ShortlistRoute } from "@features/central-cpc/shortlist-route";
import { SkillsRoute } from "@features/central-cpc/skills-route";
import { StudentDirectoryRoute } from "@features/central-cpc/students-route";
import { AttendanceRoute } from "@features/cpc/attendance-route";
import { CertificateQueue } from "@features/cpc/certificate-queue";
import { DriveProgressRoute } from "@features/cpc/drive-progress-route";
import { OffCampusQueueRoute, OptOutQueueRoute } from "@features/cpc/participation-queue-routes";
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
import { StudentDashboardRoute } from "@features/student/student-dashboard-route";
import { useAuth } from "@lib/auth-context";
import type { ReactNode } from "react";
import { Route, Routes } from "react-router";

/**
 * D3 (2026-08-12): verification is the campus placement coordinator's alone.
 * The database refuses everyone else's decisions (0042); this refuses them at
 * the door instead of rendering a queue whose buttons fail.
 */
function CampusCpcOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : null;

  if (role !== null && role !== "campus_placement_coordinator") {
    return (
      <p className="p-8 text-sm text-ink-700">
        This queue belongs to the campus placement coordinator. Registration forms and certificates
        are verified at the campus, not centrally.
      </p>
    );
  }

  return <>{children}</>;
}

/**
 * 2026-08-17 (Karthik): "the AE should only be able to view the students
 * shortlisted or selected or their drive status and results. They should not
 * be able to publish drives or shortlist students."
 *
 * Taking the links out of the sidebar is presentation, not access control: a
 * bookmark from before the change still resolves. These shut the door, and
 * they ask the domain who may come through rather than listing roles again.
 */
function ShortlistersOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : null;

  if (role !== null && !canShortlistFromPortfolio(role)) {
    return (
      <p className="p-8 text-sm text-ink-700">
        Shortlisting belongs to the placement coordinators. Choosing which students a recruiter sees
        is their decision — you can follow this drive, and its results, under “My drives”.
      </p>
    );
  }

  return <>{children}</>;
}

/**
 * The drive lifecycle is three verbs held by three different roles — raise,
 * approve, publish — and 2026-08-17 made that explicit: "AE can only raise
 * drives (no one else can raise a drive). Delivery head can only approve.
 * ... Central PC cannot raise or approve a drive."
 *
 * These guards are the doors. The separation is worth nothing if the PIF form
 * is reachable by the person who would later approve it.
 */
function RaisersOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : null;

  if (role !== null && !canRaiseDrive(role)) {
    return (
      <p className="p-8 text-sm text-ink-700">
        Only an Account Executive raises a drive. They own the recruiter’s brief, and keeping that
        separate from approving and publishing it is what makes each step a real check.
      </p>
    );
  }

  return <>{children}</>;
}

/** Approving is the Delivery Head's alone — see `canApproveDrive`. */
function ApproversOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : null;

  if (role !== null && !canApproveDrive(role)) {
    return (
      <p className="p-8 text-sm text-ink-700">
        Approving a drive belongs to the Delivery Head. They check the commercial terms the Account
        Executive agreed, which is not a check if the same person did both.
      </p>
    );
  }

  return <>{children}</>;
}

/** Publishing announces a drive to students. Central CPC only — see `canPublishDrive`. */
function PublishersOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const role = auth.status === "signed-in" ? auth.role : null;

  if (role !== null && !canPublishDrive(role)) {
    return (
      <p className="p-8 text-sm text-ink-700">
        Publishing a drive belongs to the central placement coordinator. Raising and approving a
        drive is not the same as announcing it to students.
      </p>
    );
  }

  return <>{children}</>;
}

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
                <Route path="/admin/campuses" element={<AdminCampusRoute />} />
                <Route path="/admin/staff" element={<AdminStaffRoute />} />
                {/* F6: degrees and branches are no longer a page. They belong
                    to a college, for a passing year, under /admin/campuses. */}
                <Route path="/admin/roster" element={<AdminRosterPage />} />
                <Route path="/student" element={<StudentDashboardRoute />} />
                <Route path="/student/drives" element={<StudentDrivesPage />} />
                {/* N1: the one canonical drive page, for every role. */}
                <Route path="/drives/:driveId" element={<DriveRecordRoute />} />
                {/* F2: two decisions, two heads. */}
                <Route path="/student/opt-out" element={<StudentOptOutRoute />} />
                <Route path="/student/off-campus" element={<StudentOffCampusRoute />} />
                <Route path="/student/profile" element={<StudentProfileRoute />} />
                <Route
                  path="/cpc/verification"
                  element={
                    <CampusCpcOnly>
                      <SrfVerificationQueue />
                    </CampusCpcOnly>
                  }
                />
                <Route path="/cpc/attendance" element={<AttendanceRoute />} />
                {/* D10: the campus CPC follows the whole cycle, read-only. */}
                <Route path="/cpc/drives" element={<DriveProgressRoute />} />
                {/* 2026-08-06: certificates are verified like a CGPA. */}
                <Route
                  path="/cpc/certificates"
                  element={
                    <CampusCpcOnly>
                      <CertificateQueue />
                    </CampusCpcOnly>
                  }
                />
                <Route path="/cpc/opt-outs" element={<OptOutQueueRoute />} />
                <Route path="/cpc/off-campus" element={<OffCampusQueueRoute />} />
                <Route
                  path="/ae/pif"
                  element={
                    <RaisersOnly>
                      <PifPage />
                    </RaisersOnly>
                  }
                />
                <Route path="/my-drives" element={<DrivePortfolioRoute />} />
                <Route
                  path="/delivery-head/pif-approvals"
                  element={
                    <ApproversOnly>
                      <PifApprovalQueue />
                    </ApproversOnly>
                  }
                />
                <Route
                  path="/central/shortlisting"
                  element={
                    <ShortlistersOnly>
                      <ShortlistRoute />
                    </ShortlistersOnly>
                  }
                />
                {/* PRD §5: the Central Student Skill Repository. */}
                <Route path="/central/skills" element={<SkillsRoute />} />
                {/* Every student in the placement process. Also the
                    destination of the Placed count on the overview. */}
                <Route path="/central/students" element={<StudentDirectoryRoute />} />
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
                  element={<CockpitRoute filter="yet-to-publish" />}
                />
                <Route path="/central/drives/live" element={<DrivePortfolioRoute tab="live" />} />
                <Route
                  path="/central/drives/completed"
                  element={<DrivePortfolioRoute tab="completed" />}
                />
                {/* Both old links still answer, pointing at what replaced them:
                    /central/drives was the cockpit and /central/drives/published
                    was the list that is now called Live. */}
                <Route path="/central/drives" element={<DrivePortfolioRoute tab="live" />} />
                <Route
                  path="/central/drives/published"
                  element={<DrivePortfolioRoute tab="live" />}
                />
                <Route
                  path="/central/publish"
                  element={
                    <PublishersOnly>
                      <PublishRoute />
                    </PublishersOnly>
                  }
                />
                <Route path="/central/results" element={<ResultsRoute />} />
                <Route path="/central/offers" element={<OfferRoute />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
