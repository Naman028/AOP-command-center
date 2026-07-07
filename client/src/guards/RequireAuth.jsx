import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.jsx";
import { LoadingScreen } from "../components/common/LoadingScreen.jsx";

export function RequireAuth({ children }) {
  const { status, isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <LoadingScreen />;
  }
  if (!isAuthenticated) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (user?.mustChangePassword && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  if (!user?.mustChangePassword && location.pathname === "/change-password") {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}
