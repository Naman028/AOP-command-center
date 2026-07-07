import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/http.js";
import { useAuth } from "../../auth/AuthProvider.jsx";

const roles = ["ADMIN", "MANAGER", "TEAM_LEAD", "STAFF"];
const scopedRoles = new Set(["TEAM_LEAD", "STAFF"]);
const sortOptions = ["email", "-email", "name", "-name", "role", "-role", "isActive", "-isActive", "createdAt", "-createdAt"];

const emptyUser = {
  email: "",
  name: "",
  role: "STAFF",
  temporaryPassword: "",
  assignedPlants: [],
  isActive: true
};

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [plants, setPlants] = useState([]);
  const [meta, setMeta] = useState({ page: 1, limit: 10, total: 0 });
  const [filters, setFilters] = useState({ search: "", role: "", isActive: "", sort: "email", page: 1 });
  const [state, setState] = useState({ loading: true, error: "" });
  const [editor, setEditor] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const totalPages = Math.max(1, Math.ceil(meta.total / meta.limit));

  const query = useMemo(() => {
    const params = new URLSearchParams({ sort: filters.sort, page: String(filters.page), limit: "10" });
    if (filters.search) params.set("search", filters.search);
    if (filters.role) params.set("role", filters.role);
    if (filters.isActive) params.set("isActive", filters.isActive);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let ignore = false;
    setState({ loading: true, error: "" });
    Promise.all([
      apiFetch(`/users?${query}`),
      apiFetch("/master-data/plants?isActive=true&limit=100&sort=code")
    ])
      .then(([usersData, plantsData]) => {
        if (!ignore) {
          setRows(usersData.rows);
          setMeta({ page: usersData.page, limit: usersData.limit, total: usersData.total });
          setPlants(plantsData.rows);
          setState({ loading: false, error: "" });
        }
      })
      .catch((error) => {
        if (!ignore) setState({ loading: false, error: error.message });
      });
    return () => {
      ignore = true;
    };
  }, [query, refreshKey]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value, page: name === "page" ? Number(value) : 1 }));
  }

  async function saveUser(values) {
    const isEdit = Boolean(values.id);
    const body = buildUserPayload(values, plants, isEdit);
    const path = isEdit ? `/users/${values.id}` : "/users";
    if (isEdit && !window.confirm("Changing role, status, or plant scope revokes this user's active sessions.")) return;
    await apiFetch(path, { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(body) });
    setEditor(null);
    setRefreshKey((current) => current + 1);
  }

  async function toggleStatus(row) {
    if (row.id === currentUser?.id) return;
    if (!window.confirm("Changing status revokes this user's active sessions.")) return;
    await apiFetch(`/users/${row.id}/status`, { method: "PATCH", body: JSON.stringify({ isActive: !row.isActive }) });
    setRefreshKey((current) => current + 1);
  }

  return (
    <main className="page">
      <div className="page-header">
        <h2>Users</h2>
        <button type="button" onClick={() => setEditor(emptyUser)}>Create</button>
      </div>

      <div className="toolbar">
        <input aria-label="Search" placeholder="Search" value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} />
        <select aria-label="Role" value={filters.role} onChange={(event) => updateFilter("role", event.target.value)}>
          <option value="">All roles</option>
          {roles.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <select aria-label="Status" value={filters.isActive} onChange={(event) => updateFilter("isActive", event.target.value)}>
          <option value="">All status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <select aria-label="Sort" value={filters.sort} onChange={(event) => updateFilter("sort", event.target.value)}>
          {sortOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>

      {state.loading && <p className="state-text">Loading...</p>}
      {state.error && <p className="form-error">{state.error}</p>}
      {!state.loading && !state.error && rows.length === 0 && <p className="state-text">No users found.</p>}

      {!state.loading && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Plants</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelf = row.id === currentUser?.id;
                return (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.email}</td>
                    <td>{row.role}</td>
                    <td>{row.assignedPlants?.join(", ")}</td>
                    <td><span className={row.isActive ? "badge active" : "badge inactive"}>{row.isActive ? "Active" : "Inactive"}</span></td>
                    <td className="actions">
                      <button type="button" onClick={() => setEditor(row)}>Edit</button>
                      <button type="button" disabled={isSelf} onClick={() => toggleStatus(row)}>{row.isActive ? "Deactivate" : "Activate"}</button>
                    </td>
                  </tr>
                );
              })}
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
        <UserModal
          initial={editor}
          plants={plants}
          currentUserId={currentUser?.id}
          onClose={() => setEditor(null)}
          onSave={saveUser}
        />
      )}
    </main>
  );
}

function UserModal({ initial, plants, currentUserId, onClose, onSave }) {
  const isEdit = Boolean(initial.id);
  const isSelf = initial.id === currentUserId;
  const [values, setValues] = useState(() => ({
    ...initial,
    assignedPlants: initial.assignedPlants?.map((codeOrId) => plants.find((plant) => plant.code === codeOrId)?.id ?? codeOrId) ?? []
  }));
  const [error, setError] = useState("");
  const showPlants = scopedRoles.has(values.role);

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
        <h3>{isEdit ? "Edit" : "Create"} User</h3>
        <label>
          Name
          <input value={values.name} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} required />
        </label>
        <label>
          Email
          <input type="email" value={values.email} onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))} required />
        </label>
        {!isEdit && (
          <label>
            Temporary password
            <input type="password" value={values.temporaryPassword} onChange={(event) => setValues((current) => ({ ...current, temporaryPassword: event.target.value }))} required minLength={12} />
          </label>
        )}
        <label>
          Role
          <select value={values.role} disabled={isSelf} onChange={(event) => setValues((current) => ({ ...current, role: event.target.value, assignedPlants: scopedRoles.has(event.target.value) ? current.assignedPlants : [] }))}>
            {roles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
        {showPlants && (
          <label>
            Assigned plants
            <select multiple value={values.assignedPlants} onChange={(event) => setValues((current) => ({ ...current, assignedPlants: Array.from(event.target.selectedOptions, (option) => option.value) }))}>
              {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.code} - {plant.name}</option>)}
            </select>
          </label>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={Boolean(values.isActive)}
            disabled={isSelf}
            onChange={(event) => setValues((current) => ({ ...current, isActive: event.target.checked }))}
          />
          Active
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

function buildUserPayload(values, plants, isEdit) {
  const role = values.role;
  const assignedPlants = scopedRoles.has(role)
    ? values.assignedPlants.map((codeOrId) => plants.find((plant) => plant.code === codeOrId)?.id ?? codeOrId)
    : [];
  const payload = {
    email: values.email,
    name: values.name,
    role,
    assignedPlants,
    isActive: Boolean(values.isActive)
  };
  if (!isEdit) {
    payload.temporaryPassword = values.temporaryPassword;
  }
  return payload;
}
