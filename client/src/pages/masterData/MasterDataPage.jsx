import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/http.js";
import { useAuth } from "../../auth/AuthProvider.jsx";

const configs = {
  plants: {
    title: "Plants",
    endpoint: "/master-data/plants",
    fields: [
      ["name", "Name"],
      ["code", "Code"],
      ["location", "Location"],
      ["businessUnit", "Business Unit"]
    ],
    sortOptions: ["code", "name", "location", "businessUnit"],
    empty: { name: "", code: "", location: "", businessUnit: "", isActive: true }
  },
  materials: {
    title: "Materials",
    endpoint: "/master-data/materials",
    fields: [
      ["name", "Name"],
      ["code", "Code"],
      ["category", "Category"],
      ["unit", "Unit"]
    ],
    sortOptions: ["code", "name", "category", "unit"],
    empty: { name: "", code: "", category: "", unit: "", isActive: true }
  },
  financialYears: {
    title: "Financial Years",
    endpoint: "/master-data/financial-years",
    fields: [
      ["label", "Label"],
      ["startDate", "Start"],
      ["endDate", "End"]
    ],
    sortOptions: ["label", "startDate", "endDate"],
    empty: { label: "", startDate: "", endDate: "", isActive: false }
  }
};

export function MasterDataPage({ type }) {
  const config = configs[type];
  const { user } = useAuth();
  const canWrite = user?.permissions?.includes("MASTER_DATA_MANAGE");
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });
  const [filters, setFilters] = useState({ search: "", isActive: "", sort: config.sortOptions[0], page: 1 });
  const [state, setState] = useState({ loading: true, error: "" });
  const [editor, setEditor] = useState(null);
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));

  const query = useMemo(() => {
    const params = new URLSearchParams({ sort: filters.sort, page: String(filters.page), limit: "10" });
    if (filters.search) params.set("search", filters.search);
    if (filters.isActive) params.set("isActive", filters.isActive);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let ignore = false;
    setState({ loading: true, error: "" });
    apiFetch(`${config.endpoint}?${query}`)
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
  }, [config.endpoint, query]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value, page: name === "page" ? Number(value) : 1 }));
  }

  async function saveRecord(values) {
    const method = values.id ? "PATCH" : "POST";
    const path = values.id ? `${config.endpoint}/${values.id}` : config.endpoint;
    const body = buildMasterDataPayload(config, values);
    await apiFetch(path, { method, body: JSON.stringify(body) });
    setEditor(null);
    updateFilter("page", filters.page);
  }

  async function deleteRecord(row) {
    if (!window.confirm(`Delete ${row.code ?? row.label}?`)) return;
    await apiFetch(`${config.endpoint}/${row.id}`, { method: "DELETE" });
    updateFilter("page", filters.page);
  }

  return (
    <main className="page">
      <div className="page-header">
        <h2>{config.title}</h2>
        {canWrite && <button type="button" onClick={() => setEditor(config.empty)}>Create</button>}
      </div>

      <div className="toolbar">
        <input aria-label="Search" placeholder="Search" value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} />
        <select aria-label="Status" value={filters.isActive} onChange={(event) => updateFilter("isActive", event.target.value)}>
          <option value="">All status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <select aria-label="Sort" value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}>
          {config.sortOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>

      {state.loading && <p className="state-text">Loading...</p>}
      {state.error && <p className="form-error">{state.error}</p>}
      {!state.loading && !state.error && rows.length === 0 && <p className="state-text">No records found.</p>}

      {!state.loading && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {config.fields.map(([, label]) => <th key={label}>{label}</th>)}
                <th>Status</th>
                {canWrite && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {config.fields.map(([field]) => <td key={field}>{row[field]}</td>)}
                  <td><span className={row.isActive ? "badge active" : "badge inactive"}>{row.isActive ? "Active" : "Inactive"}</span></td>
                  {canWrite && (
                    <td className="actions">
                      <button type="button" onClick={() => setEditor(row)}>Edit</button>
                      <button type="button" onClick={() => saveRecord({ ...row, isActive: !row.isActive })}>{row.isActive ? "Deactivate" : "Activate"}</button>
                      <button type="button" onClick={() => deleteRecord(row)}>Delete</button>
                    </td>
                  )}
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

      {editor && (
        <MasterDataModal
          config={config}
          initial={editor}
          onClose={() => setEditor(null)}
          onSave={saveRecord}
        />
      )}
    </main>
  );
}

function buildMasterDataPayload(config, values) {
  return {
    ...Object.fromEntries(config.fields.map(([field]) => [field, values[field]])),
    isActive: Boolean(values.isActive)
  };
}

function MasterDataModal({ config, initial, onClose, onSave }) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSave(values);
    } catch (saveError) {
      setError(saveError.message);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={submit}>
        <header className="modal-header">
          <h3>{values.id ? "Edit" : "Create"} {config.title}</h3>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>x</button>
        </header>
        <div className="modal-body">
          {config.fields.map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                name={field}
                type={field.toLowerCase().includes("date") ? "date" : "text"}
                value={values[field] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
                required
              />
            </label>
          ))}
          <label className="check-row">
            <input
              type="checkbox"
              checked={Boolean(values.isActive)}
              onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
            />
            Active
          </label>
          {error && <p className="form-error modal-error">{error}</p>}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}
