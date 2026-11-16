# Transient image reads and preview progress

## Production evidence, 2026-11-16

The owner reported missing posters and an apparently stalled six-poster preview
after publishing PR65. The current browser showed a Cloudflare HTTP520 error.
Netlify recorded a cover GET taking 65.711s end to end with only 0.686s of actual
Function execution; the preview metadata POST took 53.820s with 1.284s of Function
execution. The slow portion in those samples is outside the measured application
execution. This does not establish which infrastructure component caused it.

Read-only comparisons through the custom domain and the exact production Netlify
deploy returned identical original hashes in 1.2–1.7s. Repeating **Generate
preview** in the owner's existing session with the same six selected posters
then completed the three WebP sizes: 400×200, 800×400 and 1200×600. Publication and
the older Eastrail recovery fence were untouched.

## Client behavior

- Explicit image reads have a **20s deadline per attempt**, including the body,
  even when the caller supplied a cancellation signal. A transient connection or
  gateway failure gets one retry, for at most two attempts. This is not polling.
- The helper is used only for image bytes, image-presentation metadata and the
  read-only preview-source batch. Publication, uploads, plans and recovery writes
  retain their existing exact-key semantics.
- Authentication, permission denials, conflicts, invalid JSON/metadata and
  integrity/contract failures are not retried. Caller cancellation and identity
  changes stop further attempts. Late responses cannot populate a newer session.
- Large originals using native download chunks retain the image attempt's signal
  for every chunk and body read. Other API workflows keep their existing signals.
- Verified originals survive a transient peer/metadata failure. Each subsequent
  preview still renews its ACL/version batch before reusing bytes. Denial, invalid
  data, permission/identity changes, cancellation and disposal purge private data.
- Preview preparation displays metadata, source-count and encoding progress.
  **Cancel preview** aborts its reads and replaces its private source session;
  selection remains usable. Failed cards offer an explicit **Retry image** button
  that does not navigate their enclosing link or change the cover layout.

The infrastructure configuration is unchanged. These bounds let the UI recover
from the observed transient read failure and expose progress/cancellation; they
do not claim that the underlying gateway condition has been eliminated.

## Verification

```powershell
docker compose -f compose.local.yaml up -d --build
node scripts/m0-pending-image-recovery-smoke.cjs --transient-image-reads
```

The optional mode injects one HTTP520 for preview metadata and one original
image read. Actual Docker/OIDC/SenseNet reads must recover, and another preview
must reuse successful originals after a fresh metadata batch. A deliberately
stalled metadata request must cancel without locking selection. The existing
recovery proof then closes its synthetic old-session fixture and performs a real
three-variant publication, preserving the original hash and repository baseline.
This local fault injection does not simulate the actual Cloudflare/Netlify fault.

The Docker suite passed 481/481 tests; lint and `build:m0` passed. The native
fault-injection run passed all five acceptance checks, with zero browser
`HasPermission` calls and an unchanged original hash; cleanup restored 3018
records. Its ignored report is
`deployment/.local/pending-image-recovery/07e92f1e-dccb-4bef-b172-ca3609084212/report.json`.

Unit regressions cover bounded attempts, a hung body, interrupted streams,
identity/cancellation boundaries, invalid-data cache purge, large-original chunk
cancellation, explicit card retry and late preview results.

The owner subsequently closed the historical Eastrail attempt, confirmed by its
successful recovery request and the current UI. A new production draft job then
returned HTTP502. Its original intent/key is preserved; its saved result is still
needed to diagnose that write failure. This remains under investigation separately
from the verified image-read resilience. The original recovery procedure is in
[pending-cover-publication-recovery.md](pending-cover-publication-recovery.md).
