import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

export default function BackfillEmployersButton() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);

  const runBackfill = async (dryRun = true) => {
    setRunning(true);
    try {
      const functions = getFunctions();
      const fn = httpsCallable(functions, 'backfillEmployerFields');
      const resp = await fn({ dryRun });
      const data = resp.data || resp;
      setReport(data);
      if (dryRun) {
        const proceed = window.confirm(`Dry-run: processed ${data.processed}, would update ${data.updated} docs. Proceed with actual backfill?`);
        if (proceed) await runBackfill(false);
      } else {
        alert(`Backfill complete. processed=${data.processed}, updated=${data.updated}, errors=${data.errors}`);
      }
    } catch (err) {
      console.error(err);
      alert('Backfill failed: ' + (err.message || err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <button className="btn btn-danger" disabled={running} onClick={() => runBackfill(true)}>
        {running ? 'Running...' : 'Backfill Employer Fields (Dry-run → Confirm)'}
      </button>
      {report && (
        <div style={{ marginTop: 8 }}>
          <small>Last report: processed {report.processed}, updated {report.updated}, errors {report.errors}, dryRun={String(report.dryRun)}</small>
        </div>
      )}
    </div>
  );
}
