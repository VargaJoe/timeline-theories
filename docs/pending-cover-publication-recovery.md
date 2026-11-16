# Recovering an old cover publication

An unfinished image draft from an earlier session can hold the application's
shared pending-write fence. A new publication on another timeline then receives
`pending_recovery_required`. Retrying that rejected new job cannot finish the
older operation. Its immutable failure must not be presented as an uncertain
write belonging to the new image set.

The production report on 2026-11-16 was traced, read-only, to the unfinished
2026-11-07 Eastrail draft. Deploying new code preserves that journal; deployment
alone does not resolve the pending native outcome.

## User flow

1. Sign in as the backend user who started the old publication and open a
   timeline's **Edit Timeline → List cover** panel.
2. Expand **Recover an unfinished publication** and click
   **Check my unfinished publications**. Nothing is fetched or polled until this
   explicit action. The old draft may belong to a different timeline.
3. Select the original publication and click **Check original saved outcome**.
   If the native result is complete, its original receipt is reconciled.
4. If still unconfirmed, an operator must verify that the exact original server
   request has stopped. Its immutable registration supplies a reference, not
   stop evidence. A timeout, an old timestamp, or another released writer does
   not establish this. Only then confirm the checkbox and click
   **Close original failed attempt**.
5. Prepare a fresh preview and publish. Closure keeps the original artwork,
   published artwork and partial generated copies; it does not roll them back.

Recovery uses the existing `/images/recovery` endpoint, original operation and
original idempotency key. It sends **zero SenseNet writes**. A successful saved
receipt wins over abandonment. Explicit abandonment archives an unconfirmed
failed attempt, releases its pending fence, and preserves its native partial
state. No upload or native creation is redispatched by recovery.

## New discovery endpoint

`GET /api/v1/images/recovery/pending` requires the current backend owner session
and `covers:write`; delegated credentials cannot call discovery. It returns only
that backend identity's own recoverable **image drafts**, after renewing current
owner Save access. Renewed browser sessions can recover their earlier sessions'
drafts. Foreign operations, payloads, before-states and principals are not
disclosed.

The endpoint verifies the saved payload/hash, manifest binding and deterministic
`generationId:draft` key against the original operation ID. It searches at most
200 immutable writer registrations, using bounded strong reads. An incomplete
scan or missing registration returns no guessed references; the exact request
reference must then be supplied by the operator. Registration is never accepted
as proof that an invocation stopped.

Discovery is `no-store` and writes no aliases, receipts, transfers, coordinator
records or repository content. Other pending actions and custom agent keys still
need their original saved plan/key; this is not a general journal reset tool.

## Correct handling of the rejected new publication

The journal adds `blockedBeforeWrite: true` only after proving that the single
current operation has neither a saved intent nor a terminal receipt. The job
runner does not substitute the rejected job's operation/request references for
the old blocker. Matching references to an earlier held invocation stay intact.

The editor discards the rejected preview/intent, allows selection changes, and
does not offer recovery for that rejected current step. Already confirmed native
copies remain untouched. Missing/uncertain proof retains the existing cautious
same-key recovery behavior; an ordinary 409 does not unlock an uncertain upload.

## Verification

The local app runs only through `compose.local.yaml`, with private settings in
the ignored `.env` and persistent local Blobs state.

```powershell
docker compose -f compose.local.yaml up -d --build
node scripts/m0-pending-image-recovery-smoke.cjs
```

The smoke test creates UUID-owned local SenseNet fixtures and **seeds a synthetic
stopped old-session journal** through the real Store/Coordinator CAS API inside
the existing local Docker runtime. It does not fabricate a production receipt
or edit live journal files. It checks another timeline's rejection/unlocked
selection, explicit discovery from a renewed real OIDC session, original-key
reconciliation/closure, then a real fresh publication of three native variants.
The original binary hash and initial/final repository counts are checked.
Uncertain own state is preserved on failure. This proves the local recovery/UI
flow, not an interrupted cloud commit or production stop evidence.

The final successful run is recorded in the ignored project-local report
`deployment/.local/pending-image-recovery/81c86292-3a3f-4dff-8195-6101e5de190b/report.json`:
three acceptance checks passed, zero browser `HasPermission` requests, original
preserved, 3018 → 3018 records. The full Docker suite passed 469/469 tests; Docker
lint and `build:m0` passed. Review findings in terminal-failure wording and stale
outer errors after successful recovery were fixed and verified in this run.
Screenshots sit beside the report. Production was inspected read-only and its
old pending draft has **not** been closed by this development task.

Focused automated regressions cover foreign/old pending state, unchanged fences,
immutable rejected-job retries, original held-request provenance, discovery
authorization/privacy/bounds, malformed discovery data, no automatic queries,
exact-key retries after a lost response, and invalidating stop confirmation when
the request reference changes. `node-forge` is an explicit pinned dev dependency
for the existing HTTPS integration test certificate fixture; clean Docker
installs no longer depend on an undeclared host installation.
