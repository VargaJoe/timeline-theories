import { useEffect, useRef, useState } from 'react';
import { LazyImage } from './LazyImage';
import { imageCapabilities, imagePresentation, imageSets, deleteImageSet, sourceForGeneration, originalImageBlob, ImagePublication, OriginalImageUpload, restoreOriginalPresentation, type ImagePresentation, type ImageSetSummary } from '../services/imageVariantService';
import { captureOperationContext, invalidatePermissions, subscribePermissions } from '../services/sensenet';
import { useSharedAuth } from '../context/useSharedAuth';
import { generateImageVariants, type GeneratedImageSet } from '../utils/imageGenerator';
import type { ImageDescriptor } from '../utils/imageVariants';
import { NativeApiError, nativeSnapshot, type NativeSnapshot } from '../services/nativeApi';
import './ImagePresentationEditor.css';

export interface ImageCandidate { id: number; title: string; url: string; image?: ImageDescriptor; }
interface Props { ownerId: number; kind: 'timeline-composite' | 'media-sizes'; candidates: ImageCandidate[]; originalStored?: boolean; onSaved: (owner: NativeSnapshot) => void | Promise<void>; }
const size = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function ImagePresentationEditor({ ownerId, kind, candidates, originalStored, onSaved }: Props) {
  const auth = useSharedAuth();
  const [permissionEpoch, setPermissionEpoch] = useState(0);
  useEffect(() => subscribePermissions(() => setPermissionEpoch(value => value + 1)), []);
  const subject = JSON.stringify([ownerId, auth.accessToken, auth.user?.Id, auth.user?.sub, auth.isLoading, permissionEpoch]);
  return <ImagePresentationEditorSession key={subject} ownerId={ownerId} kind={kind} candidates={candidates} originalStored={originalStored} onSaved={onSaved} />;
}

function ImagePresentationEditorSession({ ownerId, kind, candidates, originalStored = true, onSaved }: Props) {
  const media = kind === 'media-sizes';
  const [ready, setReady] = useState(false), [unavailable, setUnavailable] = useState(false);
  const [current, setCurrent] = useState<ImagePresentation>();
  const [sets, setSets] = useState<ImageSetSummary[]>([]);
  const [selected, setSelected] = useState<number[]>([]), [page, setPage] = useState(0);
  const [generated, setGenerated] = useState<GeneratedImageSet>(), [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [terminal, setTerminal] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined), intent = useRef<ImagePublication | undefined>(undefined);
  const previewOwner = useRef<NativeSnapshot | undefined>(undefined);
  const originalIntent = useRef<OriginalImageUpload | undefined>(undefined);
  const [originalPending, setOriginalPending] = useState(false);
  const deletionKeys = useRef(new Map<number, string>());
  const unique = candidates.filter((candidate, index, all) => candidate.url && all.findIndex(other => other.id === candidate.id) === index);
  const pool = unique.slice(0, 50);
  const poolKey = pool.map(candidate => candidate.id).join(',');

  useEffect(() => {
    const abort = new AbortController(); let live = true;
    setReady(false); setUnavailable(false); setSelected([]); setGenerated(undefined); intent.current = undefined;
    void imageCapabilities(abort.signal).then(async capability => {
      if (!capability.available) { if (live) setUnavailable(true); return; }
      const image = await imagePresentation(ownerId, abort.signal, true);
      const availableSets = await imageSets(ownerId, abort.signal);
      if (live) { setCurrent(image); setSets(availableSets); if (!media && image.recipe) setSelected(image.recipe.sourceIds); setReady(true); }
    }).catch(caught => { if (live && !abort.signal.aborted) setError(caught instanceof Error ? caught.message : 'Image tools could not be loaded.'); });
    return () => { live = false; abort.abort(); controller.current?.abort(); };
  }, [ownerId, media]);
  useEffect(() => { if (media) setSelected(poolKey ? [Number(poolKey.split(',')[0])] : []); }, [media, poolKey]);
  useEffect(() => {
    const blob = generated?.variants.at(-1)?.blob;
    if (!blob) { setPreview(''); return; }
    const url = URL.createObjectURL(blob); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [generated]);

  const changeSelection = (ids: number[]) => { if (intent.current) return; setSelected(ids); setGenerated(undefined); setError(''); setStatus(''); };
  async function prepare(ids = selected, seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1) {
    if (!ids.length || busy || intent.current || media && !originalStored) return;
    const checkContext = captureOperationContext();
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(''); setStatus('Preparing preview…'); setGenerated(undefined);
    try {
      previewOwner.current = await nativeSnapshot(ownerId, { refresh: true }); checkContext();
      const sources = [];
      for (const id of ids) { sources.push(await sourceForGeneration(id, abort.signal)); checkContext(); }
      const result = await generateImageVariants({ kind, sources, seed, signal: abort.signal, fetchSource: originalImageBlob, assertContext: checkContext });
      checkContext(); if (!abort.signal.aborted) { setGenerated(result); setStatus('Preview ready. Publish when you are happy with it.'); }
    } catch (caught) { if (!abort.signal.aborted) { setError(caught instanceof Error ? caught.message : 'Preview could not be prepared.'); setStatus(''); } }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  function randomize() {
    const choices = [...pool], chosen: number[] = [];
    while (choices.length && chosen.length < 4) {
      const value = crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
      chosen.push(choices.splice(Math.floor(value * choices.length), 1)[0].id);
    }
    changeSelection(chosen); void prepare(chosen);
  }
  async function publish() {
    if (!generated || busy) return;
    const abort = new AbortController(); controller.current = abort;
    if (!previewOwner.current) { setError('Prepare a new preview before publishing.'); return; }
    intent.current ??= new ImagePublication(ownerId, generated, kind, previewOwner.current);
    setBusy(true); setError(''); setTerminal(false);
    try {
      const owner = await intent.current.publish(abort.signal, setStatus);
      const image = await imagePresentation(ownerId, abort.signal, true);
      if (abort.signal.aborted) return;
      await onSaved(owner); setCurrent(image); intent.current = undefined; setGenerated(undefined); setStatus('Published. The original images are preserved.'); invalidatePermissions();
    } catch (caught) { if (!abort.signal.aborted) {
      const uncertain = caught instanceof NativeApiError && caught.details && typeof caught.details === 'object' && 'uncertain' in caught.details && caught.details.uncertain === true;
      const confirmed = caught instanceof NativeApiError && [400, 403, 409].includes(caught.status) && !uncertain && !caught.transportFailure &&
        ['revision_conflict', 'image_source_changed', 'image_stale', 'image_draft_changed', 'permission_denied', 'backend_denied', 'image_integrity', 'invalid_image_asset', 'function_deadline'].includes(caught.code) && !caught.applyResult?.retrySamePlan && !caught.applyResult?.uncertainTargets?.length;
      setTerminal(confirmed); setError((caught instanceof Error ? caught.message : 'Publication could not finish.') + (confirmed ? ' Prepare a new preview with the current images.' : ' Retry continues this same image set.')); setStatus('');
    } }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  async function restore() {
    if (busy || intent.current) return;
    setBusy(true); setError('');
    try { const owner = await restoreOriginalPresentation(ownerId); await onSaved(owner); setCurrent(await imagePresentation(ownerId)); setStatus('Original presentation restored.'); invalidatePermissions(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not restore the original presentation.'); }
    finally { setBusy(false); }
  }
  async function cleanup() {
    const unused = sets.filter(set => set.deletable);
    if (busy || !unused.length || intent.current || !window.confirm(`Permanently delete ${unused.length} unused generated image set(s)? Original images and the published set are kept.`)) return;
    const checkContext = captureOperationContext(); setBusy(true); setError('');
    try {
      for (const set of unused) {
        checkContext();
        let key = deletionKeys.current.get(set.setId);
        if (!key) { key = crypto.randomUUID(); deletionKeys.current.set(set.setId, key); }
        await deleteImageSet(ownerId, set.setId, key);
      }
      checkContext(); setSets(await imageSets(ownerId)); setStatus('Unused generated copies deleted. Original images are preserved.');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Cleanup could not finish. Retry continues the same deletions.'); }
    finally { setBusy(false); }
  }
  async function uploadOriginal(file?: File) {
    if (busy) return;
    if (file) originalIntent.current ??= new OriginalImageUpload(ownerId, file);
    if (!originalIntent.current) return;
    const abort = new AbortController(); controller.current = abort; setBusy(true); setOriginalPending(true); setError(''); setStatus('Uploading the original image…');
    try {
      const owner = await originalIntent.current.upload(abort.signal);
      if (abort.signal.aborted) return;
      await onSaved(owner); setStatus('Original uploaded. You can now prepare its image sizes.'); invalidatePermissions();
    } catch (caught) { if (!abort.signal.aborted) { setError((caught instanceof Error ? caught.message : 'Original upload could not finish.') + ' Retry uses the same saved upload.'); setStatus(''); } }
    finally { if (!abort.signal.aborted) setBusy(false); }
  }
  if (unavailable) return <section className="image-editor"><h3>{media ? 'Image sizes' : 'List cover'}</h3><p>Image optimization is not available in this repository yet.</p></section>;
  return <section className="image-editor" aria-busy={busy}>
    <header><div><h3>{media ? 'Image sizes' : 'List cover'}</h3><p>{media ? 'Prepare smaller copies for cards and detail views. Your original stays intact.' : 'Choose up to four posters in display order, then preview and publish one compact list image.'}</p></div><span className="image-editor-state">{current?.state === 'active' ? 'Published' : current?.state === 'stale' ? 'Regeneration needed' : 'Original presentation'}</span></header>
    {!ready && !error && <p role="status">Loading image tools…</p>}
    {ready && <>
      {!media && <>
        <div className="image-editor-toolbar"><button type="button" disabled={busy || !!intent.current || !pool.length} onClick={randomize}>Random selection</button><span>From the first {pool.length} available images. Selection is saved when published.</span></div>
        <div className="image-editor-candidates">{pool.slice(page * 10, (page + 1) * 10).map(candidate => {
          const order = selected.indexOf(candidate.id);
          return <label key={candidate.id} className={order >= 0 ? 'selected' : ''}>
            <input type="checkbox" checked={order >= 0} disabled={busy || !!intent.current || order < 0 && selected.length === 4} onChange={() => changeSelection(order >= 0 ? selected.filter(id => id !== candidate.id) : [...selected, candidate.id])} />
            <div className="image-editor-thumb"><LazyImage src={candidate.url} image={candidate.image} alt="" style={{ objectFit: 'cover' }} /></div><span>{candidate.title}</span>{order >= 0 && <b>{order + 1}</b>}
          </label>;
        })}</div>
        {pool.length > 10 && <div className="image-editor-pager"><button type="button" disabled={page === 0 || busy} onClick={() => setPage(value => value - 1)}>Previous</button><span>{page + 1} / {Math.ceil(pool.length / 10)}</span><button type="button" disabled={(page + 1) * 10 >= pool.length || busy} onClick={() => setPage(value => value + 1)}>Next</button></div>}
        {!!selected.length && <ol className="image-editor-order">{selected.map((id, index) => <li key={id}>{unique.find(candidate => candidate.id === id)?.title || `Media #${id}`}<button type="button" aria-label="Move poster left" disabled={busy || !!intent.current || index === 0} onClick={() => { const ids = [...selected]; [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; changeSelection(ids); }}>←</button><button type="button" aria-label="Move poster right" disabled={busy || !!intent.current || index === selected.length - 1} onClick={() => { const ids = [...selected]; [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]; changeSelection(ids); }}>→</button><button type="button" aria-label="Remove poster" disabled={busy || !!intent.current} onClick={() => changeSelection(selected.filter(value => value !== id))}>Remove</button></li>)}</ol>}
      </>}
      {(!pool.length || media && !originalStored) && <p>Upload a PNG, JPEG or WebP original first. Linked images are preserved, but sizes are generated from originals stored in this repository.</p>}
      {media && !originalStored && <div className="image-editor-toolbar"><label>Upload original <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || originalPending} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadOriginal(file); }} /></label><span>The selected original is saved immediately, without resizing.</span>{originalPending && <button type="button" disabled={busy} onClick={() => void uploadOriginal()}>Retry original upload</button>}</div>}
      <div className={'image-editor-preview ' + (media ? 'media' : 'timeline')}>{preview ? <img src={preview} alt="Generated image preview" /> : current?.state === 'active' ? <LazyImage src="" image={current} alt="Published image" style={{ objectFit: 'contain' }} /> : <span>{current?.state === 'stale' ? 'Source images changed. Prepare a new preview.' : media ? 'Image size preview' : 'List cover preview'}</span>}</div>
      {generated && <ul className="image-editor-sizes">{generated.variants.map(variant => <li key={variant.name}>{variant.width} × {variant.height} · {variant.mimeType.replace('image/', '')} · {size(variant.byteLength)}</li>)}</ul>}
      <div className="image-editor-actions"><button type="button" disabled={busy || !!intent.current || !selected.length || media && !originalStored} onClick={() => void prepare()}>{media ? 'Prepare sizes' : 'Generate preview'}</button><button type="button" className="primary" disabled={busy || !generated} onClick={() => void publish()}>{intent.current ? 'Retry publication' : 'Publish'}</button>{current?.state !== 'legacy' && current?.state !== undefined && <button type="button" disabled={busy || !!intent.current} onClick={() => void restore()}>Use original presentation</button>}</div>
      {terminal && <button type="button" disabled={busy} onClick={() => { intent.current = undefined; previewOwner.current = undefined; setGenerated(undefined); setTerminal(false); setError(''); setStatus('Choose the current images and prepare a new preview. Unpublished copies can be removed with Delete unused copies.'); void imageSets(ownerId).then(setSets).catch(() => {}); }}>Start a new preview</button>}
      {!!sets.filter(set => set.deletable).length && <div className="image-editor-toolbar"><button type="button" disabled={busy || !!intent.current} onClick={() => void cleanup()}>Delete unused copies</button><span>{sets.filter(set => set.deletable).length} inactive image set(s). Published and original images are kept.</span></div>}
    </>}
    {status && <p role="status">{status}</p>}{error && <p role="alert" className="image-editor-error">{error}</p>}
  </section>;
}
