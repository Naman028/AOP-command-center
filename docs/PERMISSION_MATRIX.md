# Permission Matrix

## Roles

Do not check only roles everywhere. Define permissions once and map roles to them.

## Permissions

| Permission | Description |
| --- | --- |
| `DASHBOARD_VIEW` | View dashboard. |
| `MASTER_DATA_VIEW` | View plants, materials, and financial years. |
| `MASTER_DATA_MANAGE` | Create, update, or deactivate master data. |
| `TARGETS_VIEW` | View planning targets. |
| `TARGETS_MANAGE` | Create, update, or delete targets. |
| `ACTUALS_VIEW` | View actuals. |
| `ACTUALS_MANAGE` | Create, update, or delete actuals. |
| `IMPORTS_MANAGE` | Preview and confirm file imports. |
| `REPORTS_VIEW` | View reports. |
| `REPORTS_EXPORT` | Export authorized reports. |
| `USERS_MANAGE` | Create, update, deactivate users, and change roles. |
| `AUDIT_LOGS_VIEW` | View audit logs. |

## Role Mapping

| Role | Permissions | Scope |
| --- | --- | --- |
| `ADMIN` | All permissions | All plants and reports |
| `MANAGER` | `DASHBOARD_VIEW`, `MASTER_DATA_VIEW`, `TARGETS_VIEW`, `TARGETS_MANAGE`, `ACTUALS_VIEW`, `ACTUALS_MANAGE`, `IMPORTS_MANAGE`, `REPORTS_VIEW`, `REPORTS_EXPORT` | All operational data |
| `TEAM_LEAD` | `DASHBOARD_VIEW`, `TARGETS_VIEW`, `TARGETS_MANAGE`, `ACTUALS_VIEW`, `ACTUALS_MANAGE`, `IMPORTS_MANAGE`, `REPORTS_VIEW`, `REPORTS_EXPORT` | Assigned plants only |
| `STAFF` | `DASHBOARD_VIEW`, `REPORTS_VIEW` | Read-only assigned scope unless explicitly expanded |

## Protected Routes

| Route | Access |
| --- | --- |
| `/login` | Public |
| `/unauthorized` | Public |
| `/dashboard` | All signed-in roles |
| `/master-data/*` | Admin and Manager view |
| `/master-data` write actions | Admin only |
| `/planning/*` | Admin, Manager, Team Lead |
| `/actuals/manual-entry` | Admin, Manager, Team Lead |
| `/actuals/file-drop` | Admin, Manager, Team Lead |
| `/reports/*` | Signed-in users, filtered by plant scope |
| `/admin/users` | Admin only |
| `/admin/audit-logs` | Admin only |

## Plant Scope Rule

For every Team Lead request, the backend must build the database filter from the verified user's `assignedPlants`. It must not accept a plant ID from the browser as proof of access.

