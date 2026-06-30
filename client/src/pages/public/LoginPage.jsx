import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider.jsx";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const returnTo = new URLSearchParams(location.search).get("returnTo") || "/dashboard";

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await login({ email: form.get("email"), password: form.get("password") });
      navigate(returnTo, { replace: true });
    } catch {
      setError("Invalid email or password");
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={onSubmit}>
        <h1>AOP Command Center</h1>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
