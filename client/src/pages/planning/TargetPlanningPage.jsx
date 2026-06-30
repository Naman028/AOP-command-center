import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/http.js";
import { useAuth } from "../../auth/AuthProvider.jsx";

const pageConfig = {
  TURNOVER: { title: "Turnover Planning", path: "/planning/turnover", unit: "USD" },
  EXPENSE: { title: "Expense Planning", path: "/planning/expenses", unit: "USD" },
  CONSUMPTION: { title: "Consumption Planning", path: "/planning/consumption", unit: "EA" },
  EARNINGS: { title: "Earnings Planning", path: "/planning/earnings", unit: "USD" }
};

const months = Array.from({ length: 12 }, (_, index) => index + 1);

export function TargetPlanningPage({ metricType }) {
  const config = pageConfig[metricType];
  const { user } = useAuth();
  const canManage = user?.permissions?.includes("TARGETS_MANAGE");
  const [targets, setTargets] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });
  const [refs, setRefs] = useState({ plants: [], financialYears: [], materials: [] });
  const [filters, setFilters] = useState({ plant: "", financialYear: "", month: "", category: "", material: "", isActive: "true", sort: "month", page: 1 });
  const [state, setState] = useState({ loading: true, error: "" });
  const [editor, setEditor] = useState(null);
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));
  const isConsumption = metricType === "CONSUMPTION";

  const visiblePlants = useMemo(() => {
    if (user?.role !== "TEAM_LEAD") return refs.plants;
    return refs.plants.filter((plant) => user.assignedPlants?.includes(plant.code));
  }, [refs.plants, user]);

  const query = useMemo(() => {
    const params = new URLSearchParams({ metricType, sort: filters.sort, page: String(filters.page), limit: "10" });
    for (const field of ["plant", "financialYear", "month", "category", "material", "isActive"]) {
      if (filters[field]) params.set(field, String(filters[field]));
    }
    return params.toString();
  }, [filters, metricType]);

  useEffect(() => {
    let ignore = false;
    Promise.all([
      apiFetch("/master-data/plants?isActive=true&limit=100"),
      apiFetch("/master-data/financial-years?isActive=true&limit=100"),
      apiFetch("/master-data/materials?isActive=true&limit=100")
    ]).then(([plants, financialYears, materials]) => {
      if (!ignore) {
        setRefs({ plants: plants.rows, financialYears: financialYears.rows, materials: materials.rows });
      }
    }).catch((error) => {
      if (!ignore) setState({ loading: false, error: error.message });
    });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    setState({ loading: true, error: "" });
    apiFetch(`/targets?${query}`)
      .then((data) => {
        if (!ignore) {
          setTargets(data.rows);
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

  function newTarget() {
    setEditor({
      plant: visiblePlants[0]?.id ?? "",
      financialYear: refs.financialYears[0]?.id ?? "",
      month: 1,
      metricType,
      category: "TOTAL",
      material: "",
      plannedValue: "",
      unit: config.unit,
      notes: ""
    });
  }

  async function saveTarget(values) {
    const body = {
      plant: values.plant,
      financialYear: values.financialYear,
      month: Number(values.month),
      metricType,
      category: values.category || "TOTAL",
      plannedValue: Number(values.plannedValue),
      unit: values.unit,
      notes: values.notes ?? ""
    };
    if (isConsumption) {
      body.material = values.material;
    }
    const path = values.id ? `/targets/${values.id}` : "/targets";
    const method = values.id ? "PATCH" : "POST";
    await apiFetch(path, { method, body: JSON.stringify(body) });
    setEditor(null);
    updateFilter("page", filters.page);
  }

  async function setStatus(row, isActive) {
    await apiFetch(`/targets/${row.id}/status`, { method: "PATCH", body: JSON.stringify({ isActive }) });
    updateFilter("page", filters.page);
  }

  return (
    <main className="page">
      <div className="page-header">
        <h2>{config.title}</h2>
        {canManage && <button type="button" onClick={newTarget}>Create</button>}
      </div>

      <div className="toolbar">
        <select aria-label="Plant" value={filters.plant} onChange={(event) => updateFilter("plant", event.target.value)}>
          <option value="">All plants</option>
          {visiblePlants.map((plant) => <option key={plant.id} value={plant.id}>{plant.code}</option>)}
        </select>
        <select aria-label="Financial year" value={filters.financialYear} onChange={(event) => updateFilter("financialYear", event.target.value)}>
          <option value="">All years</option>
          {refs.financialYears.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
        </select>
        <select aria-label="Month" value={filters.month} onChange={(event) => updateFilter("month", event.target.value)}>
          <option value="">All months</option>
          {months.map((month) => <option key={month} value={month}>{month}</option>)}
        </select>
        <input aria-label="Category" placeholder="Category" value={filters.category} onChange={(event) => updateFilter("category", event.target.value)} />
        {isConsumption && (
          <select aria-label="Material" value={filters.material} onChange={(event) => updateFilter("material", event.target.value)}>
            <option value="">All materials</option>
            {refs.materials.map((material) => <option key={material.id} value={material.id}>{material.code}</option>)}
          </select>
        )}
        <select aria-label="Status" value={filters.isActive} onChange={(event) => updateFilter("isActive", event.target.value)}>
          <option value="">All status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {state.loading && <p className="state-text">Loading...</p>}
      {state.error && <p className="form-error">{state.error}</p>}
      {!state.loading && !state.error && targets.length === 0 && <p className="state-text">No targets found.</p>}

      {!state.loading && targets.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Plant</th>
                <th>Year</th>
                <th>Month</th>
                <th>Category</th>
                {isConsumption && <th>Material</th>}
                <th>Planned</th>
                <th>Unit</th>
                <th>Status</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => (
                <tr key={target.id}>
                  <td>{target.plant?.code}</td>
                  <td>{target.financialYear?.label}</td>
                  <td>{target.month}</td>
                  <td>{target.category}</td>
                  {isConsumption && <td>{target.material?.code}</td>}
                  <td>{target.plannedValue}</td>
                  <td>{target.unit}</td>
                  <td><span className={target.isActive ? "badge active" : "badge inactive"}>{target.isActive ? "Active" : "Inactive"}</span></td>
                  {canManage && (
                    <td className="actions">
                      <button type="button" onClick={() => setEditor({ ...target, plant: target.plant.id, financialYear: target.financialYear.id, material: target.material?.id ?? "" })}>Edit</button>
                      <button type="button" onClick={() => setStatus(target, !target.isActive)}>{target.isActive ? "Deactivate" : "Reactivate"}</button>
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
        <TargetModal
          values={editor}
          setValues={setEditor}
          refs={{ plants: visiblePlants, financialYears: refs.financialYears, materials: refs.materials }}
          isConsumption={isConsumption}
          onClose={() => setEditor(null)}
          onSave={saveTarget}
        />
      )}
    </main>
  );
}

function TargetModal({ values, setValues, refs, isConsumption, onClose, onSave }) {
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
        <h3>{values.id ? "Edit" : "Create"} Target</h3>
        <label>
          Plant
          <select value={values.plant} onChange={(event) => setValues((current) => ({ ...current, plant: event.target.value }))} required>
            {refs.plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.code}</option>)}
          </select>
        </label>
        <label>
          Financial Year
          <select value={values.financialYear} onChange={(event) => setValues((current) => ({ ...current, financialYear: event.target.value }))} required>
            {refs.financialYears.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
          </select>
        </label>
        <label>
          Month
          <select value={values.month} onChange={(event) => setValues((current) => ({ ...current, month: event.target.value }))} required>
            {months.map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
        </label>
        <label>
          Category
          <input value={values.category} onChange={(event) => setValues((current) => ({ ...current, category: event.target.value }))} required />
        </label>
        {isConsumption && (
          <label>
            Material
            <select value={values.material} onChange={(event) => setValues((current) => ({ ...current, material: event.target.value }))} required>
              <option value="">Select material</option>
              {refs.materials.map((material) => <option key={material.id} value={material.id}>{material.code}</option>)}
            </select>
          </label>
        )}
        <label>
          Planned Value
          <input type="number" min="0.01" step="0.01" value={values.plannedValue} onChange={(event) => setValues((current) => ({ ...current, plannedValue: event.target.value }))} required />
        </label>
        <label>
          Unit
          <input value={values.unit} onChange={(event) => setValues((current) => ({ ...current, unit: event.target.value }))} required />
        </label>
        <label>
          Notes
          <input value={values.notes ?? ""} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}
