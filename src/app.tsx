import { AppShell } from "@components/app-shell";
import { LoginPage } from "@features/auth/login-page";
import { RequireAuth } from "@features/auth/require-auth";
import { RoleLanding } from "@features/auth/role-landing";
import { DafPublish } from "@features/central-cpc/daf-publish";
import { DriveCockpit } from "@features/central-cpc/drive-cockpit";
import { ShortlistingWorkspace } from "@features/central-cpc/shortlisting-workspace";
import { AttendancePage } from "@features/cpc/attendance-page";
import { SrfVerificationQueue } from "@features/cpc/srf-verification-queue";
import { PifApprovalQueue } from "@features/delivery-head/pif-approval-queue";
import { SrfPage } from "@features/srf/srf-page";
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
                <Route path="/student" element={<StudentDashboard />} />
                <Route path="/cpc/verification" element={<SrfVerificationQueue />} />
                <Route path="/cpc/attendance" element={<AttendancePage />} />
                <Route path="/delivery-head/pif-approvals" element={<PifApprovalQueue />} />
                <Route path="/central/shortlisting" element={<ShortlistingWorkspace />} />
                <Route path="/central/drives" element={<DriveCockpit />} />
                <Route path="/central/publish" element={<DafPublish />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
