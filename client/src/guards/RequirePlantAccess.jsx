import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.jsx";

export function RequirePlantAccess({ plantId, children }) {
  const { user } = useAuth();
  const unrestricted = user?.role === "ADMIN" || user?.role === "MANAGER";
  if (!unrestricted && plantId && !user?.assignedPlants?.includes(plantId)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return children;
}
