export function PasswordInput({ name, autoComplete, visible, onToggle, minLength }) {
  return (
    <span className="password-control">
      <input
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={minLength}
      />
      <button
        type="button"
        className="password-toggle icon-button"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={onToggle}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6A2.9 2.9 0 0 0 12 15a3 3 0 0 0 2.7-1.7" />
      <path d="M7.1 7.5C4.2 9.2 2.5 12 2.5 12s3.5 6 9.5 6c1.6 0 3-.4 4.2-1" />
      <path d="M14.1 6.3A9.6 9.6 0 0 0 12 6c-6 0-9.5 6-9.5 6s1 1.7 2.8 3.2" />
      <path d="M17.4 8.2c2.6 1.7 4.1 3.8 4.1 3.8s-.8 1.4-2.2 2.8" />
    </svg>
  );
}
