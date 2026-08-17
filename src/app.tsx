import { AppShell } from "@components/app-shell";
import { canPublishDrive, canShortlistFromPortfolio } from "@domain/drive-portfolio";
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
import { AttendanceRoute } from "@features/cpc/attendance-route";
import { CertificateQueue } from "@features/cpc/certificate-queue";
import { DriveProgressRoute } from "@features/cpc/drive-progress-route";
import { OffCampusQueueRoute, OptOutQueueRoute } from "@features/cpc/participation-queue-routes";
import { SrfVerificationQueue } from "@features/cpc/srf-verification-queue";
import { DashboardRoute } from "@features/dashboard/dashboard-route";
import { PifApprovalQueue } from "@features/delivery-head/pif-approval-queue";
import { DrivePortfolioRoute } from "@features/drive-portfolio/portfolio-route";
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
                <Route path="/ae/pif" element={<PifPage />} />
                <Route path="/my-drives" element={<DrivePortfolioRoute />} />
                <Route path="/delivery-head/pif-approvals" element={<PifApprovalQueue />} />
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
                <Route path="/central/drives" element={<CockpitRoute />} />
                {/* D2: the Central CPC's pipeline, split. */}
                <Route
                  path="/central/drives/yet-to-publish"
                  element={<CockpitRoute filter="yet-to-publish" />}
                />
                <Route
                  path="/central/drives/published"
                  element={<CockpitRoute filter="published" />}
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
