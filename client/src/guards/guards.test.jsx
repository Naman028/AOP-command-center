import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider.jsx";
import { SessionBootstrap } from "../auth/SessionBootstrap.jsx";
import { RequireAuth } from "./RequireAuth.jsx";
import { RequirePermission } from "./RequirePermission.jsx";
import { RequirePlantAccess } from "./RequirePlantAccess.jsx";

function renderProtected({ meResponse, path = "/admin/users", permission = "USERS_MANAGE", plantId }) {
  global.fetch = vi.fn(async () => meResponse);
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <SessionBootstrap>
          <Routes>
            <Route path="/login" element={<h1>Login</h1>} />
            <Route path="/change-password" element={<h1>Change Password</h1>} />
            <Route path="/unauthorized" element={<h1>Unauthorized</h1>} />
            <Route
              path={path}
              element={(
                <RequireAuth>
                  <RequirePermission permission={permission}>
                    <RequirePlantAccess plantId={plantId}>
                      <h1>Protected Content</h1>
                    </RequirePlantAccess>
                  </RequirePermission>
                </RequireAuth>
              )}
            />
          </Routes>
        </SessionBootstrap>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe("route guards", () => {
  it("shows loading while /auth/me is pending and never flashes protected content", () => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    render(
      <MemoryRouter initialEntries={["/admin/users"]}>
        <AuthProvider>
          <SessionBootstrap>
            <RequireAuth>
              <h1>Protected Content</h1>
            </RequireAuth>
          </SessionBootstrap>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Protected Content")).toBeNull();
  });

  it("redirects direct protected URLs without a session to login with returnTo", async () => {
    renderProtected({
      meResponse: new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      })
    });

    await waitFor(() => expect(screen.getByText("Login")).toBeTruthy());
    expect(window.location.search).toBe("");
  });

  it("redirects authenticated users without permission to unauthorized", async () => {
    renderProtected({
      meResponse: Response.json({
        user: {
          role: "STAFF",
          assignedPlants: ["PLANT-A"],
          permissions: ["DASHBOARD_VIEW"]
        }
      })
    });

    await waitFor(() => expect(screen.getByText("Unauthorized")).toBeTruthy());
  });

  it("redirects temporary-password users from direct protected URLs to change password", async () => {
    renderProtected({
      path: "/dashboard",
      permission: "DASHBOARD_VIEW",
      meResponse: Response.json({
        user: {
          role: "STAFF",
          assignedPlants: ["PLANT-A"],
          mustChangePassword: true,
          permissions: ["DASHBOARD_VIEW"]
        }
      })
    });

    await waitFor(() => expect(screen.getByText("Change Password")).toBeTruthy());
    expect(screen.queryByText("Protected Content")).toBeNull();
  });

  it("renders for valid permission and assigned plant", async () => {
    renderProtected({
      permission: "REPORTS_VIEW",
      plantId: "PLANT-A",
      path: "/reports",
      meResponse: Response.json({
        user: {
          role: "TEAM_LEAD",
          assignedPlants: ["PLANT-A"],
          permissions: ["REPORTS_VIEW"]
        }
      })
    });

    await waitFor(() => expect(screen.getByText("Protected Content")).toBeTruthy());
  });

  it("redirects Staff and Manager away from admin users and audit routes", async () => {
    for (const role of ["STAFF", "MANAGER"]) {
      for (const path of ["/admin/users", "/admin/audit-logs"]) {
        renderProtected({
          path,
          permission: path.includes("audit") ? "AUDIT_LOGS_VIEW" : "USERS_MANAGE",
          meResponse: Response.json({
            user: {
              role,
              assignedPlants: ["PLANT-A", "PLANT-B"],
              permissions: ["DASHBOARD_VIEW", "REPORTS_VIEW"]
            }
          })
        });
        await waitFor(() => expect(screen.getByText("Unauthorized")).toBeTruthy());
        cleanup();
      }
    }
  });

  it("allows Manager direct URL access to master-data pages and denies Staff", async () => {
    renderProtected({
      path: "/master-data/plants",
      permission: "MASTER_DATA_VIEW",
      meResponse: Response.json({
        user: {
          role: "MANAGER",
          assignedPlants: ["PLANT-A", "PLANT-B"],
          permissions: ["MASTER_DATA_VIEW"]
        }
      })
    });
    await waitFor(() => expect(screen.getByText("Protected Content")).toBeTruthy());
    cleanup();

    renderProtected({
      path: "/master-data/plants",
      permission: "MASTER_DATA_VIEW",
      meResponse: Response.json({
        user: {
          role: "STAFF",
          assignedPlants: ["PLANT-A"],
          permissions: ["DASHBOARD_VIEW", "REPORTS_VIEW"]
        }
      })
    });
    await waitFor(() => expect(screen.getByText("Unauthorized")).toBeTruthy());
  });
});
