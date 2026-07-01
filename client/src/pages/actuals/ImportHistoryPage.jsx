import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/http.js";

export function ImportHistoryPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0 });
  const [filters, setFilters] = useState({ status: "", page: 1 });
  const [state, setState] = useState({ loading: true, error: "" });
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(filters.page), limit: "20", sort: "-createdAt" });
    if (filters.status) params.set("status", filters.status);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let ignore = false;
    setState({ loading: true, error: "" });
    apiFetch(`/imports/history?${query}`)
      .then((data) => {
        if (!ignore) {
          setRows(data.rows);
          setMeta({ page: data.page, limit: data.limit, total: data.total });
          setState({ loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (!ignore) setState({ loading: false, error: error.message });
      });
    return () => {
      ignore = true;
    };
  }, [query]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value, page: name === "page" ? Number(value) : 1 }));
  }

  return (
    <main className="page">
      <div className="page-header">
        <h2>Import History</h2>
      </div>
      <div className="toolbar">
        <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
          <option value="">All status</option>
          {["PREVIEWED", "CONFIRMING", "IMPORTED", "REJECTED", "FAILED", "EXPIRED"].map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>

      {state.loading && <p className="state-text">Loading...</p>}
      {state.error && <p className="form-error">{state.error}</p>}
      {!state.loading && !state.error && rows.length === 0 && <p className="state-text">No import batches found.</p>}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Status</th><th>File</th><th>Total</th><th>Valid</th><th>Invalid</th><th>Errors</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>{row.status}</td>
                  <td>{row.fileNameSafe}</td>
                  <td>{row.totalRows}</td>
                  <td>{row.validRows}</td>
                  <td>{row.invalidRows}</td>
                  <td>{row.validationErrors?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pagination">
        <button type="button" disabled={filters.page <= 1} onClick={() => updateFilter("page", filters.page - 1)}>Previous</button>
        <span>Page {meta.page} of {totalPages}</span>
        <button type="button" disabled={filters.page >= totalPages} onClick={() => updateFilter("page", filters.page + 1)}>Next</button>
      </div>
    </main>
  );
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}
