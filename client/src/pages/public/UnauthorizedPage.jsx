import { Link } from "react-router-dom";

export function UnauthorizedPage() {
  return (
    <main className="page">
      <h1>Unauthorized</h1>
      <p>Your account does not have access to this page.</p>
      <Link to="/dashboard">Back to dashboard</Link>
    </main>
  );
}
