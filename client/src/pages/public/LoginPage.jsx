import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { PasswordInput } from "../../components/common/PasswordInput.jsx";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const returnTo = new URLSearchParams(location.search).get("returnTo") || "/dashboard";

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const user = await login({ email: form.get("email"), password: form.get("password") });
      navigate(user.mustChangePassword ? "/change-password" : returnTo, { replace: true });
    } catch {
      setError("Invalid email or password");
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel auth-panel" onSubmit={onSubmit}>
        <section className="auth-brand" aria-label="AOP Command Center">
          <span className="auth-mark">AOP</span>
          <h1>Command Center</h1>
        </section>
        <section className="auth-form">
          <div className="auth-heading">
            <h2>Sign in</h2>
          </div>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <PasswordInput
              name="password"
              autoComplete="current-password"
              visible={showPassword}
              onToggle={() => setShowPassword((current) => !current)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit">Sign in</button>
        </section>
      </form>
    </main>
  );
}
