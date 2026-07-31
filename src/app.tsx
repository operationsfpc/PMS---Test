import { AppShell } from "@components/app-shell";
import { ShortlistingWorkspace } from "@features/central-cpc/shortlisting-workspace";
import { AttendancePage } from "@features/cpc/attendance-page";
import { SrfVerificationQueue } from "@features/cpc/srf-verification-queue";
import { PifApprovalQueue } from "@features/delivery-head/pif-approval-queue";
import { SrfPage } from "@features/srf/srf-page";
import { StudentDashboard } from "@features/student/student-dashboard";
import { Navigate, Route, Routes } from "react-router";

export function App() {
  return (
    <Routes>
      {/* The SRF is full-bleed: it has its own focused chrome. */}
      <Route path="/srf" element={<SrfPage />} />
      <Route
        path="*"
        element={
          <AppShell>
            <Routes>
              <Route path="/" element={<Navigate to="/student" replace />} />
              <Route path="/student" element={<StudentDashboard />} />
              <Route path="/cpc/verification" element={<SrfVerificationQueue />} />
              <Route path="/cpc/attendance" element={<AttendancePage />} />
              <Route path="/delivery-head/pif-approvals" element={<PifApprovalQueue />} />
              <Route path="/central/shortlisting" element={<ShortlistingWorkspace />} />
              <Route path="/central/drives" element={<ShortlistingWorkspace />} />
            </Routes>
          </AppShell>
        }
      />
    </Routes>
  );
}
