import { AppShell } from "@components/app-shell";
import { AdminCampusRoute } from "@features/admin/campus-route";
import { AdminProgrammesRoute } from "@features/admin/programmes-route";
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
import { AttendanceRoute } from "@features/cpc/attendance-route";
import { ParticipationQueueRoute } from "@features/cpc/participation-queue-route";
import { SrfVerificationQueue } from "@features/cpc/srf-verification-queue";
import { DashboardRoute } from "@features/dashboard/dashboard-route";
import { PifApprovalQueue } from "@features/delivery-head/pif-approval-queue";
import { DrivePortfolioRoute } from "@features/drive-portfolio/portfolio-route";
import { PifPage } from "@features/pif/pif-page";
import { SrfRoute } from "@features/srf/srf-route";
import { StudentDrivesPage } from "@features/student/drives-page";
import { ParticipationRoute } from "@features/student/participation-route";
import { StudentProfileRoute } from "@features/student/profile-route";
import { StudentDashboardRoute } from "@features/student/student-dashboard-route";
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
                <Route path="/admin/campuses" element={<AdminCampusRoute />} />
                <Route path="/admin/staff" element={<AdminStaffRoute />} />
                <Route path="/admin/programmes" element={<AdminProgrammesRoute />} />
                <Route path="/admin/roster" element={<AdminRosterPage />} />
                <Route path="/student" element={<StudentDashboardRoute />} />
                <Route path="/student/drives" element={<StudentDrivesPage />} />
                <Route path="/student/participation" element={<ParticipationRoute />} />
                <Route path="/student/profile" element={<StudentProfileRoute />} />
                <Route path="/cpc/verification" element={<SrfVerificationQueue />} />
                <Route path="/cpc/attendance" element={<AttendanceRoute />} />
                <Route path="/cpc/participation" element={<ParticipationQueueRoute />} />
                <Route path="/ae/pif" element={<PifPage />} />
                <Route path="/my-drives" element={<DrivePortfolioRoute />} />
                <Route path="/delivery-head/pif-approvals" element={<PifApprovalQueue />} />
                <Route path="/central/shortlisting" element={<ShortlistRoute />} />
                <Route path="/central/drives" element={<CockpitRoute />} />
                <Route path="/central/publish" element={<PublishRoute />} />
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
