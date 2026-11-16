import { useEffect, useRef, useState } from 'react';
import { pendingImagePublications, recoverPendingImage, type PendingImagePublication } from '../services/imageRecoveryService';

/** Explicit recovery survives a page reload without keeping tokens or image
 * bytes in browser storage. A check never automatically closes an attempt. */
export function PendingImageRecovery({ disabled = false, onResolved }: { disabled?: boolean; onResolved?: () => void }) {
  const [pending, setPending] = useState<PendingImagePublication[]>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [selected, setSelected] = useState(''), [requestId, setRequestId] = useState(''), [confirmed, setConfirmed] = useState(false);
  const controller = useRef<AbortController>();
  useEffect(() => () => controller.current?.abort(), []);
  const operation = pending?.find(item => item.operationId === selected);
  const referenceValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId);
  const choose = (item?: PendingImagePublication) => {
    setSelected(item?.operationId || ''); setRequestId(item?.requestIds.length === 1 ? item.requestIds[0] : ''); setConfirmed(false);
  };
  async function discover() {
    if (busy || disabled) return;
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setBusy(true); setError(''); setMessage(''); setPending(undefined); choose();
    try {
      const items = await pendingImagePublications(abort.signal);
      if (!abort.signal.aborted) { setPending(items); if (items.length === 1) choose(items[0]); }
    } catch (caught) { if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unfinished publications could not be checked.'); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  async function recover(abandon: boolean) {
    if (busy || disabled || !operation || abandon && (!confirmed || !referenceValid)) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await recoverPendingImage(operation, abort.signal, abandon ? { requestId, confirmStopped: true, abandon: true } : {});
      if (abort.signal.aborted) return;
      if (!result.pending) {
        setPending(items => items?.filter(item => item.operationId !== operation.operationId)); choose();
        onResolved?.();
        const failed = result.abandoned || result.failure || result.notPrepared;
        setMessage(!failed && result.confirmed ? 'The saved step is confirmed. You can prepare a fresh preview. Existing images are preserved.'
          : 'The failed attempt is closed. Existing images and unfinished copies are preserved. You can prepare a fresh preview.');
      } else setMessage('The saved result is still unconfirmed. No upload was repeated. Verify the original server request has stopped before closing this attempt.');
    } catch (caught) { if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : 'Publication recovery could not finish.'); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  return <details className="image-editor-recovery">
    <summary>Recover an unfinished publication</summary>
    <p>A previous image save can block new publications, including on another timeline. Check your saved attempts here, even after reopening the page.</p>
    <button type="button" disabled={busy || disabled} onClick={() => void discover()}>Check my unfinished publications</button>
    {pending?.length === 0 && <p>No recoverable unfinished cover drafts were found for your account and current access. Other pending writes need their original plan or key.</p>}
    {!!pending?.length && <>
      <label>Unfinished publication <select value={selected} disabled={busy || disabled} onChange={event => choose(pending.find(item => item.operationId === event.target.value))}>
        <option value="">Choose a publication</option>
        {pending.map(item => <option key={item.operationId} value={item.operationId}>{item.title} (#{item.ownerId})</option>)}
      </select></label>
      {operation && <>
        <p>Original operation: <code>{operation.operationId}</code></p>
        <button type="button" disabled={busy || disabled} onClick={() => void recover(false)}>Check original saved outcome</button>
        <label>Original server request <input type="text" value={requestId} disabled={busy || disabled} onChange={event => { setRequestId(event.target.value.trim()); setConfirmed(false); }} placeholder="Exact request UUID" /></label>
        {operation.requestIds.length > 1 && <p>Recorded requests: {operation.requestIds.join(', ')}. Verify which exact request stopped.</p>}
        <label><input type="checkbox" checked={confirmed} disabled={busy || disabled || !referenceValid} onChange={event => setConfirmed(event.target.checked)} /> I verified this exact server request has stopped. A timeout alone does not confirm it.</label>
        <button type="button" disabled={busy || disabled || !confirmed || !referenceValid} onClick={() => void recover(true)}>Close original failed attempt</button>
      </>}
    </>}
    {busy && <p role="status">Checking saved publication…</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
