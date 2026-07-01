import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/http.js";

const reportConfig = {
  targetData: {
    title: "Target Data Report",
    path: "/reports/target-data",
    type: "target-data"
  },
  summary: {
    title: "Summary Report",
    path: "/reports/summary",
    type: "summary"
  },
  plantPerformance: {
    title: "Plant Performance",
    path: "/reports/plant-performance",
    type: "plant-performance"
  }
};

const metricTypes = ["TURNOVER", "EXPENSE", "CONSUMPTION", "EARNINGS"];
const months = Array.from({ length: 12 }, (_, index) => index + 1);

export function ReportPage({ report }) {
  const config = reportConfig[report];
  const [data, setData] = useState({ rows: [], dataStatusCounts: null, performanceStatusCounts: null, page: 1, limit: 20, total: 0 });
  const [financialYears, setFinancialYears] = useState([]);
  const [filters, setFilters] = useState({ financialYear: "", metricType: "", month: "", page: 1 });
  const [state, setState] = useState({ loading: true, error: "" });
  const totalPages = Math.max(1, Math.ceil((data.total || data.rows.length || 0) / (data.limit || 20)));

  const query = useMemo(() => {
    const params = new URLSearchParams({ financialYear: filters.financialYear, page: String(filters.page), limit: "20" });
    if (filters.metricType) params.set("metricType", filters.metricType);
    if (filters.month) params.set("month", filters.month);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let ignore = false;
    apiFetch("/master-data/financial-years?isActive=true&limit=100")
      .then((response) => {
        if (!ignore) {
          setFinancialYears(response.rows);
          setFilters((current) => ({ ...current, financialYear: current.financialYear || response.rows[0]?.id || "" }));
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
    if (!filters.financialYear) return undefined;
    let ignore = false;
    setState({ loading: true, error: "" });
    apiFetch(`${config.path}?${query}`)
      .then((response) => {
        if (!ignore) {
          setData(response);
          setState({ loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (!ignore) setState({ loading: false, error: error.message });
      });
    return () => {
      ignore = true;
    };
  }, [config.path, query]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value, page: name === "page" ? Number(value) : 1 }));
  }

  return (
    <main className="page">
      <div className="page-header">
        <h2>{config.title}</h2>
      </div>

      <div className="toolbar">
        <select aria-label="Financial year" value={filters.financialYear} onChange={(event) => updateFilter("financialYear", event.target.value)}>
          {financialYears.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
        </select>
        <select aria-label="Metric" value={filters.metricType} onChange={(event) => updateFilter("metricType", event.target.value)}>
          <option value="">All metrics</option>
          {metricTypes.map((metric) => <option key={metric} value={metric}>{metric}</option>)}
        </select>
        <select aria-label="Month" value={filters.month} onChange={(event) => updateFilter("month", event.target.value)}>
          <option value="">All months</option>
          {months.map((month) => <option key={month} value={month}>{month}</option>)}
        </select>
      </div>

      {data.dataStatusCounts && <StatusStrip title="Data" counts={data.dataStatusCounts} />}
      {data.performanceStatusCounts && <StatusStrip title="Performance" counts={data.performanceStatusCounts} />}
      {state.loading && <p className="state-text">Loading...</p>}
      {state.error && <p className="form-error">{state.error}</p>}
      {!state.loading && !state.error && data.rows.length === 0 && <p className="state-text">No report rows found.</p>}
      {!state.loading && data.rows.length > 0 && (
        config.type === "target-data"
          ? <TargetDataTable rows={data.rows} />
          : <SummaryTable rows={data.rows} showPlant={config.type === "plant-performance"} />
      )}
      {config.type === "target-data" && (
        <div className="pagination">
          <button type="button" disabled={filters.page <= 1} onClick={() => updateFilter("page", filters.page - 1)}>Previous</button>
          <span>Page {data.page} of {totalPages}</span>
          <button type="button" disabled={filters.page >= totalPages} onClick={() => updateFilter("page", filters.page + 1)}>Next</button>
        </div>
      )}
    </main>
  );
}

function TargetDataTable({ rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Plant</th>
            <th>Year</th>
            <th>Month</th>
            <th>Metric</th>
            <th>Category</th>
            <th>Material</th>
            <th>Target</th>
            <th>Actual</th>
            <th>Unit</th>
            <th>Variance</th>
            <th>Attainment</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.plant.id}-${row.financialYear.id}-${row.month}-${row.metricType}-${row.category}-${row.material?.id ?? "none"}`}>
              <td>{row.plant.code}</td>
              <td>{row.financialYear.label}</td>
              <td>{row.month}</td>
              <td>{row.metricType}</td>
              <td>{row.category}</td>
              <td>{row.material?.code ?? "-"}</td>
              <td>{formatNumber(row.plannedValue)}</td>
              <td>{formatNumber(row.actualValue)}</td>
              <td>{row.dataStatus === "UNIT_MISMATCH" ? `${row.targetUnit} / ${row.actualUnit}` : row.unit}</td>
              <td>{formatNumber(row.variance)}</td>
              <td>{formatPercent(row.attainmentPct)}</td>
              <td><span className={`badge ${dataStatusClass(row.dataStatus)}`}>{statusLabel(row.dataStatus)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryTable({ rows, showPlant }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {showPlant && <th>Plant</th>}
            <th>Metric</th>
            <th>Unit</th>
            <th>Rows</th>
            <th>Planned</th>
            <th>Actual</th>
            <th>Variance</th>
            <th>Attainment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.plant?.id ?? "all"}-${row.metricType}-${row.unit}`}>
              {showPlant && <td>{row.plant.code}</td>}
              <td>{row.metricType}</td>
              <td>{row.unit}</td>
              <td>{row.rowCount}</td>
              <td>{formatNumber(row.plannedValue)}</td>
              <td>{formatNumber(row.actualValue)}</td>
              <td>{formatNumber(row.variance)}</td>
              <td>{formatPercent(row.attainmentPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusStrip({ title, counts }) {
  return (
    <div className="status-strip">
      <span><strong>{title}</strong></span>
      {Object.entries(counts).map(([status, count]) => (
        <span key={status}><strong>{count}</strong> {statusLabel(status)}</span>
      ))}
    </div>
  );
}

function dataStatusClass(status) {
  if (status === "MATCHED") return "active";
  if (status === "MISSING_ACTUAL" || status === "MISSING_TARGET" || status === "UNIT_MISMATCH") return "inactive";
  return "warning";
}

function statusLabel(status) {
  return status.toLowerCase().replaceAll("_", " ");
}

function formatNumber(value) {
  return value === null || value === undefined ? "-" : Number(value).toLocaleString();
}

function formatPercent(value) {
  return value === null || value === undefined ? "-" : `${formatNumber(value)}%`;
}
