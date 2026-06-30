import { useEffect } from "react";
import { useAuth } from "./AuthProvider.jsx";
import { LoadingScreen } from "../components/common/LoadingScreen.jsx";

export function SessionBootstrap({ children }) {
  const { status, bootstrap } = useAuth();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (status === "checking") {
    return <LoadingScreen />;
  }

  return children;
}
