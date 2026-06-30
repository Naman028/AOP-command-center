import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider.jsx";
import { LoadingScreen } from "../components/common/LoadingScreen.jsx";

export function RequireAuth({ children }) {
  const { status, isAuthenticated } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <LoadingScreen />;
  }
  if (!isAuthenticated) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return children;
}
