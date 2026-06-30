import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider.jsx";

export function AppLayout() {
  const { user, logout } = useAuth();
  const can = (permission) => user?.permissions?.includes(permission);

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>AOP</h1>
        <nav>
          <Link to="/dashboard">Dashboard</Link>
          {can("MASTER_DATA_VIEW") && <Link to="/master-data/plants">Plants</Link>}
          {can("MASTER_DATA_VIEW") && <Link to="/master-data/materials">Materials</Link>}
          {can("MASTER_DATA_VIEW") && <Link to="/master-data/financial-years">Financial Years</Link>}
          {can("TARGETS_VIEW") && <Link to="/planning/turnover">Turnover</Link>}
          {can("TARGETS_VIEW") && <Link to="/planning/expenses">Expenses</Link>}
          {can("TARGETS_VIEW") && <Link to="/planning/consumption">Consumption</Link>}
          {can("TARGETS_VIEW") && <Link to="/planning/earnings">Earnings</Link>}
          {can("ACTUALS_VIEW") && <Link to="/actuals/manual-entry">Manual Actuals</Link>}
          {can("IMPORTS_MANAGE") && <Link to="/actuals/file-drop">File Drop</Link>}
          {can("REPORTS_VIEW") && <Link to="/reports">Reports</Link>}
          {can("USERS_MANAGE") && <Link to="/admin/users">Users</Link>}
          {can("AUDIT_LOGS_VIEW") && <Link to="/admin/audit-logs">Audit</Link>}
        </nav>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <span>{user?.name}</span>
          <button type="button" onClick={logout}>Sign out</button>
        </header>
        <Outlet />
      </section>
    </div>
  );
}
