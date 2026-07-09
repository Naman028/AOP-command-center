import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { PasswordInput } from "../../components/common/PasswordInput.jsx";

export function ChangePasswordPage() {
  const { changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [visibleFields, setVisibleFields] = useState({});

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

  function toggleField(name) {
    setVisibleFields((current) => ({ ...current, [name]: !current[name] }));
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={onSubmit}>
        <h1>Change Password</h1>
        <label>
          Current password
          <PasswordInput
            name="currentPassword"
            autoComplete="current-password"
            visible={Boolean(visibleFields.currentPassword)}
            onToggle={() => toggleField("currentPassword")}
          />
        </label>
        <label>
          New password
          <PasswordInput
            name="newPassword"
            autoComplete="new-password"
            visible={Boolean(visibleFields.newPassword)}
            onToggle={() => toggleField("newPassword")}
            minLength={12}
          />
        </label>
        <label>
          Confirm new password
          <PasswordInput
            name="confirmPassword"
            autoComplete="new-password"
            visible={Boolean(visibleFields.confirmPassword)}
            onToggle={() => toggleField("confirmPassword")}
            minLength={12}
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button type="submit">Update password</button>
        <button type="button" onClick={signOut}>Sign out</button>
      </form>
    </main>
  );
}
