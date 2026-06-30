export function DashboardPage() {
  return (
    <main className="page">
      <h2>Dashboard</h2>
      <section className="metric-grid">
        <div className="metric-card">
          <span>Output</span>
          <strong>300</strong>
        </div>
        <div className="metric-card">
          <span>Open imports</span>
          <strong>0</strong>
        </div>
      </section>
    </main>
  );
}
