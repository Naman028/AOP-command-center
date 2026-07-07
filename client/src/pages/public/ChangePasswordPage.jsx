import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider.jsx";

export function ChangePasswordPage() {
  const { changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== form.get("confirmPassword")) {
      setError("Passwords do not match");
      return;
    }
    try {
      await changePassword({
        currentPassword: form.get("currentPassword"),
        newPassword
      });
      navigate("/login", { replace: true });
    } catch (changeError) {
      setError(changeError.message);
    }
  }

  async function signOut() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={onSubmit}>
        <h1>Change Password</h1>
        <label>
          Current password
          <input name="currentPassword" type="password" autoComplete="current-password" required />
        </label>
        <label>
          New password
          <input name="newPassword" type="password" autoComplete="new-password" required minLength={12} />
        </label>
        <label>
          Confirm new password
          <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit">Update password</button>
        <button type="button" onClick={signOut}>Sign out</button>
      </form>
    </main>
  );
}
