import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.jsx";

export function RequirePermission({ permission, children }) {
  const { user } = useAuth();
  if (!user?.permissions?.includes(permission)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return children;
}
