import { useState } from "react";
import { apiFetch } from "../../api/http.js";

const template = [
  "plantCode,financialYearLabel,month,metricType,category,materialCode,actualValue,unit,notes",
  "PLANT-A,2026,1,TURNOVER,TOTAL,,100,USD,"
].join("\n");

export function FileDropPage() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState({ loading: false, error: "", message: "" });

  function downloadTemplate() {
    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "actual-import-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    setState({ loading: true, error: "", message: "" });
    const body = new FormData();
    body.append("file", file);
    try {
      const data = await apiFetch("/imports/preview", { method: "POST", body });
      setPreview(data);
      setState({ loading: false, error: "", message: "Preview created" });
    } catch (error) {
      setPreview(null);
      setState({ loading: false, error: error.message, message: "" });
    }
  }

  async function confirm() {
    setState({ loading: true, error: "", message: "" });
    try {
      await apiFetch(`/imports/${preview.batch.id}/confirm`, { method: "POST" });
      setState({ loading: false, error: "", message: "Import confirmed" });
    } catch (error) {
      setState({ loading: false, error: error.message, message: "" });
    }
  }

  const hasErrors = preview?.batch?.invalidRows > 0;
  const canConfirm = preview && !hasErrors && preview.transactionAvailable;

  return (
    <main className="page">
      <div className="page-header">
        <h2>File Drop</h2>
        <button type="button" onClick={downloadTemplate}>Template</button>
      </div>

      <form className="upload-panel" onSubmit={upload}>
        <label>
          Actual import file
          <input type="file" accept=".csv,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button type="submit" disabled={!file || state.loading}>Preview</button>
      </form>

      {state.error && <p className="form-error">{state.error}</p>}
      {state.message && <p className="state-text">{state.message}</p>}

      {preview && (
        <>
          <div className="metric-grid">
            <div className="metric-card"><span>Total rows</span><strong>{preview.batch.totalRows}</strong></div>
            <div className="metric-card"><span>Valid</span><strong>{preview.batch.validRows}</strong></div>
            <div className="metric-card"><span>Invalid</span><strong>{preview.batch.invalidRows}</strong></div>
          </div>

          {!preview.transactionAvailable && <p className="form-error">Confirmation requires transaction-capable MongoDB.</p>}
          <button type="button" disabled={!canConfirm || state.loading} onClick={confirm}>Confirm import</button>

          {preview.rows.errors.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Row</th><th>Errors</th></tr></thead>
                <tbody>
                  {preview.rows.errors.map((row) => (
                    <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.errors.join(", ")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.rows.valid.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Row</th><th>Plant</th><th>Month</th><th>Metric</th><th>Category</th><th>Value</th><th>Unit</th></tr></thead>
                <tbody>
                  {preview.rows.valid.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>{row.plantCode}</td>
                      <td>{row.month}</td>
                      <td>{row.metricType}</td>
                      <td>{row.category}</td>
                      <td>{row.actualValue}</td>
                      <td>{row.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
