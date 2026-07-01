import { useEffect, useState } from "react";
import { apiFetch } from "../../api/http.js";

export function DashboardPage() {
  const [dashboard, setDashboard] = useState(null);
  const [financialYears, setFinancialYears] = useState([]);
  const [financialYear, setFinancialYear] = useState("");
  const [state, setState] = useState({ loading: true, error: "" });

  useEffect(() => {
    let ignore = false;
    apiFetch("/master-data/financial-years?isActive=true&limit=100")
      .then((data) => {
        if (!ignore) {
          setFinancialYears(data.rows);
          setFinancialYear(data.rows[0]?.id ?? "");
        }
      })
      .catch((error) => {
        if (!ignore) setState({ loading: false, error: error.message });
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!financialYear) return undefined;
    let ignore = false;
    setState({ loading: true, error: "" });
    apiFetch(`/dashboard/overview?financialYear=${encodeURIComponent(financialYear)}`)
      .then((data) => {
        if (!ignore) {
          setDashboard(data.dashboard);
          setState({ loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (!ignore) setState({ loading: false, error: error.message });
      });
    return () => {
      ignore = true;
    };
  }, [financialYear]);

  return (
    <main className="page">
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>
      <div className="toolbar">
        <select aria-label="Financial year" value={financialYear} onChange={(event) => setFinancialYear(event.target.value)}>
          {financialYears.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
        </select>
      </div>
      {state.loading && <p className="state-text">Loading...</p>}
      {state.error && <p className="form-error">{state.error}</p>}
      {dashboard && (
        <>
          <section className="metric-grid">
            <Metric label="Matched rows" value={dashboard.totals.matchedRows} />
            <Metric label="Missing actuals" value={dashboard.totals.missingActualRows} />
            <Metric label="Missing targets" value={dashboard.totals.missingTargetRows} />
            <Metric label="Unit mismatches" value={dashboard.totals.unitMismatchRows} />
            <Metric label="Zero targets" value={dashboard.totals.zeroTargetRows} />
            <Metric label="Matched attainment" value={formatPercent(dashboard.totals.matchedAttainmentPct)} />
          </section>
          <section className="report-section">
            <h3>Metric Summary</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Unit</th>
                    <th>Planned</th>
                    <th>Actual</th>
                    <th>Variance</th>
                    <th>Attainment</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.byMetric.map((row) => (
                    <tr key={`${row.metricType}-${row.unit}`}>
                      <td>{row.metricType}</td>
                      <td>{row.unit}</td>
                      <td>{formatNumber(row.plannedValue)}</td>
                      <td>{formatNumber(row.actualValue)}</td>
                      <td>{formatNumber(row.variance)}</td>
                      <td>{formatPercent(row.attainmentPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatNumber(value) {
  return value === null || value === undefined ? "-" : Number(value).toLocaleString();
}

function formatPercent(value) {
  return value === null || value === undefined ? "-" : `${formatNumber(value)}%`;
}
