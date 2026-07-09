import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider.jsx";

export function AppLayout() {
  const { user, logout } = useAuth();
  const can = (permission) => user?.permissions?.includes(permission);
  const linkClass = ({ isActive }) => (isActive ? "active" : undefined);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-block">
          <h1>AOP</h1>
          <span>Command Center</span>
        </div>
        <nav>
          <div className="nav-group">
            <span className="nav-label">Overview</span>
            <NavLink to="/dashboard" className={linkClass}>Dashboard</NavLink>
          </div>
          {can("MASTER_DATA_VIEW") && (
            <div className="nav-group">
              <span className="nav-label">Master Data</span>
              <NavLink to="/master-data/plants" className={linkClass}>Plants</NavLink>
              <NavLink to="/master-data/materials" className={linkClass}>Materials</NavLink>
              <NavLink to="/master-data/financial-years" className={linkClass}>Financial Years</NavLink>
            </div>
          )}
          {can("TARGETS_VIEW") && (
            <div className="nav-group">
              <span className="nav-label">Planning</span>
              <NavLink to="/planning/turnover" className={linkClass}>Turnover</NavLink>
              <NavLink to="/planning/expenses" className={linkClass}>Expenses</NavLink>
              <NavLink to="/planning/consumption" className={linkClass}>Consumption</NavLink>
              <NavLink to="/planning/earnings" className={linkClass}>Earnings</NavLink>
            </div>
          )}
          {(can("ACTUALS_VIEW") || can("IMPORTS_MANAGE")) && (
            <div className="nav-group">
              <span className="nav-label">Actuals</span>
              {can("ACTUALS_VIEW") && <NavLink to="/actuals/manual-entry" className={linkClass}>Manual Actuals</NavLink>}
              {can("IMPORTS_MANAGE") && <NavLink to="/actuals/file-drop" className={linkClass}>File Drop</NavLink>}
              {can("IMPORTS_MANAGE") && <NavLink to="/actuals/import-history" className={linkClass}>Import History</NavLink>}
            </div>
          )}
          {can("REPORTS_VIEW") && (
            <div className="nav-group">
              <span className="nav-label">Reports</span>
              <NavLink to="/reports/target-data" className={linkClass}>Target Data</NavLink>
              <NavLink to="/reports/summary" className={linkClass}>Summary</NavLink>
              <NavLink to="/reports/plant-performance" className={linkClass}>Plant Performance</NavLink>
            </div>
          )}
          {(can("USERS_MANAGE") || can("AUDIT_LOGS_VIEW")) && (
            <div className="nav-group">
              <span className="nav-label">Admin</span>
              {can("USERS_MANAGE") && <NavLink to="/admin/users" className={linkClass}>Users</NavLink>}
              {can("AUDIT_LOGS_VIEW") && <NavLink to="/admin/audit-logs" className={linkClass}>Audit</NavLink>}
            </div>
          )}
        </nav>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div className="user-chip">
            <span>{user?.name}</span>
            <small>{user?.role?.replace("_", " ")}</small>
          </div>
          <button type="button" onClick={logout}>Sign out</button>
        </header>
        <Outlet />
      </section>
    </div>
  );
}
