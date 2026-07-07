import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../auth/AuthProvider.jsx";
import { SessionBootstrap } from "../auth/SessionBootstrap.jsx";
import { AppLayout } from "../components/layout/AppLayout.jsx";
import { RequireAuth } from "../guards/RequireAuth.jsx";
import { RequirePermission } from "../guards/RequirePermission.jsx";
import { AuditLogsPage } from "../pages/admin/AuditLogsPage.jsx";
import { UsersPage } from "../pages/admin/UsersPage.jsx";
import { ActualEntryPage } from "../pages/actuals/ActualEntryPage.jsx";
import { FileDropPage } from "../pages/actuals/FileDropPage.jsx";
import { ImportHistoryPage } from "../pages/actuals/ImportHistoryPage.jsx";
import { DashboardPage } from "../pages/dashboard/DashboardPage.jsx";
import { MasterDataPage } from "../pages/masterData/MasterDataPage.jsx";
import { TargetPlanningPage } from "../pages/planning/TargetPlanningPage.jsx";
import { ReportPage } from "../pages/reports/ReportPage.jsx";
import { ChangePasswordPage } from "../pages/public/ChangePasswordPage.jsx";
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
            <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<RequirePermission permission="DASHBOARD_VIEW"><DashboardPage /></RequirePermission>} />
              <Route path="/master-data/plants" element={<RequirePermission permission="MASTER_DATA_VIEW"><MasterDataPage type="plants" /></RequirePermission>} />
              <Route path="/master-data/materials" element={<RequirePermission permission="MASTER_DATA_VIEW"><MasterDataPage type="materials" /></RequirePermission>} />
              <Route path="/master-data/financial-years" element={<RequirePermission permission="MASTER_DATA_VIEW"><MasterDataPage type="financialYears" /></RequirePermission>} />
              <Route path="/planning" element={<Navigate to="/planning/turnover" replace />} />
              <Route path="/planning/turnover" element={<RequirePermission permission="TARGETS_VIEW"><TargetPlanningPage metricType="TURNOVER" /></RequirePermission>} />
              <Route path="/planning/expenses" element={<RequirePermission permission="TARGETS_VIEW"><TargetPlanningPage metricType="EXPENSE" /></RequirePermission>} />
              <Route path="/planning/consumption" element={<RequirePermission permission="TARGETS_VIEW"><TargetPlanningPage metricType="CONSUMPTION" /></RequirePermission>} />
              <Route path="/planning/earnings" element={<RequirePermission permission="TARGETS_VIEW"><TargetPlanningPage metricType="EARNINGS" /></RequirePermission>} />
              <Route path="/actuals/manual-entry" element={<RequirePermission permission="ACTUALS_VIEW"><ActualEntryPage /></RequirePermission>} />
              <Route path="/actuals/file-drop" element={<RequirePermission permission="IMPORTS_MANAGE"><FileDropPage /></RequirePermission>} />
              <Route path="/actuals/import-history" element={<RequirePermission permission="IMPORTS_MANAGE"><ImportHistoryPage /></RequirePermission>} />
              <Route path="/reports" element={<Navigate to="/reports/target-data" replace />} />
              <Route path="/reports/target-data" element={<RequirePermission permission="REPORTS_VIEW"><ReportPage report="targetData" /></RequirePermission>} />
              <Route path="/reports/summary" element={<RequirePermission permission="REPORTS_VIEW"><ReportPage report="summary" /></RequirePermission>} />
              <Route path="/reports/plant-performance" element={<RequirePermission permission="REPORTS_VIEW"><ReportPage report="plantPerformance" /></RequirePermission>} />
              <Route path="/admin/users" element={<RequirePermission permission="USERS_MANAGE"><UsersPage /></RequirePermission>} />
              <Route path="/admin/audit-logs" element={<RequirePermission permission="AUDIT_LOGS_VIEW"><AuditLogsPage /></RequirePermission>} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </SessionBootstrap>
      </AuthProvider>
    </BrowserRouter>
  );
}
