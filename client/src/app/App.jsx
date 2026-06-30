import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../auth/AuthProvider.jsx";
import { SessionBootstrap } from "../auth/SessionBootstrap.jsx";
import { AppLayout } from "../components/layout/AppLayout.jsx";
import { RequireAuth } from "../guards/RequireAuth.jsx";
import { RequirePermission } from "../guards/RequirePermission.jsx";
import { DashboardPage } from "../pages/dashboard/DashboardPage.jsx";
import { MasterDataPage } from "../pages/masterData/MasterDataPage.jsx";
import { SimplePage } from "../pages/SimplePage.jsx";
import { LoginPage } from "../pages/public/LoginPage.jsx";
import { NotFoundPage } from "../pages/public/NotFoundPage.jsx";
import { UnauthorizedPage } from "../pages/public/UnauthorizedPage.jsx";

function ProtectedLayout() {
  return (
    <RequireAuth>
      <AppLayout />
    </RequireAuth>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SessionBootstrap>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<RequirePermission permission="DASHBOARD_VIEW"><DashboardPage /></RequirePermission>} />
              <Route path="/master-data/plants" element={<RequirePermission permission="MASTER_DATA_VIEW"><MasterDataPage type="plants" /></RequirePermission>} />
              <Route path="/master-data/materials" element={<RequirePermission permission="MASTER_DATA_VIEW"><MasterDataPage type="materials" /></RequirePermission>} />
              <Route path="/master-data/financial-years" element={<RequirePermission permission="MASTER_DATA_VIEW"><MasterDataPage type="financialYears" /></RequirePermission>} />
              <Route path="/planning" element={<RequirePermission permission="TARGETS_VIEW"><SimplePage title="Planning" /></RequirePermission>} />
              <Route path="/actuals/file-drop" element={<RequirePermission permission="IMPORTS_MANAGE"><SimplePage title="File Drop" /></RequirePermission>} />
              <Route path="/reports" element={<RequirePermission permission="REPORTS_VIEW"><SimplePage title="Reports" /></RequirePermission>} />
              <Route path="/admin/users" element={<RequirePermission permission="USERS_MANAGE"><SimplePage title="Users" /></RequirePermission>} />
              <Route path="/admin/audit-logs" element={<RequirePermission permission="AUDIT_LOGS_VIEW"><SimplePage title="Audit Logs" /></RequirePermission>} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </SessionBootstrap>
      </AuthProvider>
    </BrowserRouter>
  );
}
