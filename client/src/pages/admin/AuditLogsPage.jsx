import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/http.js";

const sortOptions = ["-createdAt", "createdAt", "action", "-action", "entityType", "-entityType"];

export function AuditLogsPage() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 20, total: 0 });
  const [filters, setFilters] = useState({ action: "", entityType: "", entityId: "", plantId: "", sort: "-createdAt", page: 1 });
  const [state, setState] = useState({ loading: true, error: "" });
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));

  const query = useMemo(() => {
    const params = new URLSearchParams({ sort: filters.sort, page: String(filters.page), limit: "20" });
    for (const field of ["action", "entityType", "entityId", "plantId"]) {
      if (filters[field]) params.set(field, filters[field]);
    }
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let ignore = false;
    setState({ loading: true, error: "" });
    apiFetch(`/audit-logs?${query}`)
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
        <h2>Audit Logs</h2>
      </div>

      <div className="toolbar">
        <input aria-label="Action" placeholder="Action" value={filters.action} onChange={(event) => updateFilter("action", event.target.value)} />
        <input aria-label="Entity type" placeholder="Entity type" value={filters.entityType} onChange={(event) => updateFilter("entityType", event.target.value)} />
        <input aria-label="Entity id" placeholder="Entity id" value={filters.entityId} onChange={(event) => updateFilter("entityId", event.target.value)} />
        <input aria-label="Plant" placeholder="Plant" value={filters.plantId} onChange={(event) => updateFilter("plantId", event.target.value)} />
        <select aria-label="Sort" value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}>
          {sortOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>

      {state.loading && <p className="state-text">Loading...</p>}
      {state.error && <p className="form-error">{state.error}</p>}
      {!state.loading && !state.error && rows.length === 0 && <p className="state-text">No audit logs found.</p>}

      {!state.loading && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Plant</th>
                <th>Actor</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id ?? `${row.requestId}-${row.createdAt}`}>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>{row.action}</td>
                  <td>{row.entityType}{row.entityId ? `:${row.entityId}` : ""}</td>
                  <td>{row.plantId ?? ""}</td>
                  <td>{row.actorUserId ?? ""}</td>
                  <td>{row.requestId ?? ""}</td>
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
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}
