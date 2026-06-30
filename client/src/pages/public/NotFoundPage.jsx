import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="page">
      <h1>Not found</h1>
      <Link to="/dashboard">Back to dashboard</Link>
    </main>
  );
}
