import { AppShell } from "@components/app-shell";
import { AdminCampusRoute } from "@features/admin/campus-route";
import { AdminProgrammesRoute } from "@features/admin/programmes-route";
import { AdminRosterPage } from "@features/admin/roster-page";
import { AdminStaffRoute } from "@features/admin/staff-route";
import { LoginPage } from "@features/auth/login-page";
import { RequireAuth } from "@features/auth/require-auth";
import { RoleLanding } from "@features/auth/role-landing";
import { DafPublish } from "@features/central-cpc/daf-publish";
import { DriveCockpit } from "@features/central-cpc/drive-cockpit";
import { OfferRoute } from "@features/central-cpc/offer-route";
import { ResultsRoute } from "@features/central-cpc/results-route";
import { ShortlistingWorkspace } from "@features/central-cpc/shortlisting-workspace";
import { AttendanceRoute } from "@features/cpc/attendance-route";
import { ParticipationQueueRoute } from "@features/cpc/participation-queue-route";
import { SrfVerificationQueue } from "@features/cpc/srf-verification-queue";
import { PifApprovalQueue } from "@features/delivery-head/pif-approval-queue";
import { PifPage } from "@features/pif/pif-page";
import { SrfPage } from "@features/srf/srf-page";
import { StudentDrivesPage } from "@features/student/drives-page";
import { ParticipationRoute } from "@features/student/participation-route";
import { StudentDashboard } from "@features/student/student-dashboard";
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
            <SrfPage />
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
                <Route path="/admin/campuses" element={<AdminCampusRoute />} />
                <Route path="/admin/staff" element={<AdminStaffRoute />} />
                <Route path="/admin/programmes" element={<AdminProgrammesRoute />} />
                <Route path="/admin/roster" element={<AdminRosterPage />} />
                <Route path="/student" element={<StudentDashboard />} />
                <Route path="/student/drives" element={<StudentDrivesPage />} />
                <Route path="/student/participation" element={<ParticipationRoute />} />
                <Route path="/cpc/verification" element={<SrfVerificationQueue />} />
                <Route path="/cpc/attendance" element={<AttendanceRoute />} />
                <Route path="/cpc/participation" element={<ParticipationQueueRoute />} />
                <Route path="/ae/pif" element={<PifPage />} />
                <Route path="/delivery-head/pif-approvals" element={<PifApprovalQueue />} />
                <Route path="/central/shortlisting" element={<ShortlistingWorkspace />} />
                <Route path="/central/drives" element={<DriveCockpit />} />
                <Route path="/central/publish" element={<DafPublish />} />
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
