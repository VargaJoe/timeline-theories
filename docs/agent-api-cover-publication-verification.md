# Agent API verification and cover publication repair

Verified locally on 2026-11-15/16, starting from `develop` `d7bf794f`, on `feature/agent-api-cover-publication`. The application remains React/Vite plus the existing Netlify Functions API. SenseNet remains the image/content store.

## Publication changes

The controlled stock-HTTPS scenario performed 107 backend requests to prepare a two-source draft inside the former 25-second synchronous budget. This demonstrates latency sensitivity; it does not establish the physical cause of the historical production Cloudflare 502.

Draft preparation, sealing and inactive-set deletion now use metadata-only background jobs. HTTP 202 acknowledges work; the client waits for the terminal job response. Identical operation/key/input retries share the same job. A permanent claim prevents automatic runtime redelivery from executing it again. Variant uploads retain their bounded synchronous transport; generated image bytes never enter job input or mutation receipts.

Stored results recheck current owner Save and selected-source Open. Explicit recovery can finish a stopped job from a confirmed native receipt. If an immutable job error was saved after the native commit, a conditional mapping points to a completed receipt view, preserving the old error and dispatching no worker.

For an unresolved outcome, an owner can explicitly confirm the exact original invocation stopped and close the attempt as a terminal failure. This preserves native partial state, clears the matching pending fence and performs zero SenseNet writes. Historical request/job records prove provenance, not stop. Missing ownership, original key, binding, current permission or stop confirmation remains a denial. The UI unlocks a new preview only after `pending:false`; a successful receipt is never replaced by abandonment.

## Evidence

| Gate | Result |
| --- | --- |
| Unit/contract suite | 417 passed |
| Metadata/read/receipt parity | 98 checks passed |
| Lint and production build | Passed |
| Base-image native HTTPS API | 24 passed |
| Base-image whole-plan preflight | 13 passed |
| Base-image concurrent operations | 3 passed |
| Base-image large PNG/ZIP transfer | 5 passed |
| Base-image actual Docker restart | 6 passed |
| Base-image local read-only profile | 4 passed; normal app restored |
| Patched-app editor/Visitor image UI | 20 checks passed across verified continuations |
| Patched-app independent native client/Chromium | 10 passed; zero raw browser repository mutations |
| Patched-app physical pending-image-worker interruption | Passed: prepared unknown outcome explicitly abandoned, no repository redispatch |

The 55 base-image API checks tested `d7bf794f` before integration. The patched app then passed the separate UI/native integration and interruption gates. SHA-256 comparison verified all nine changed runtime files match the Docker image. Every real-content gate restored the original **3018** records; existing demos and user content were preserved. Temporary native grants were revoked.

Large transfers round-tripped a 6,294,468-byte PNG and a 12,590,254-byte ZIP with exact hashes. The editor exercised 1–4 posters, WebP/PNG output, consecutive publications, original upload, media sizes, cleanup, current permissions and unchanged original hashes. Controlled losses verified both one uploaded file's unchanged version and one metadata job's exact key/generation with no duplicate set.

Visitor acceptance measured a 384px DPR2 card using one 1200px atlas for approximately 893 atlas pixels required by its cropped poster faces; zero original/entry-pool requests occurred. The media thumbnail used 320px and the detail view 640px. Mobile containment, lazy loading, no focus refresh and fresh-page owner denial passed.

The interruption gate observed the exact owned container exited before restart, with no terminal job result at that checkpoint. It recovered the original prepared operation through the owner API, confirmed terminal `image_publication_abandoned`, preserved the original SHA, cleaned both UUID fixtures and restored 3018 records and a healthy app. It changes no SenseNet runtime, SQL, volume or environment configuration. A missed interruption checkpoint is a failed acceptance, not a simulated success.

Private evidence is ignored under `deployment/.local/agent-image-publication-2026-11-15/`; the image UI continuation chain is under `deployment/.local/image-ui-smoke/a773d017-ddb1-4a71-b2b8-830c3f004f94/`, native/browser proof under `m1-browser-api-smoke/b900e0e8-fa6d-49fc-a513-82833fafe84c/`, and interruption proof under `image-job-recovery/35f2a428-f7cf-4caa-965e-44b57501c95d/`. Private state/token files must remain ignored.

## Repeatable checks

Run content-writing gates **sequentially**, with no competing editor or agent writes. They capture the current baseline and clean only their UUID fixtures.

```powershell
docker compose -f compose.local.yaml up -d --build app
npm run local:check
npm test
npm run test:parity
npm run lint
npm run build
node --dns-result-order=ipv4first scripts/m1-native-smoke.mjs --providers
node --dns-result-order=ipv4first scripts/m1-preflight-smoke.mjs
node --dns-result-order=ipv4first scripts/m1-concurrency-smoke.mjs --run
node --dns-result-order=ipv4first scripts/m1-large-transfer-smoke.mjs --run
node --dns-result-order=ipv4first scripts/m1-browser-api-smoke.cjs
node --dns-result-order=ipv4first scripts/m0-image-ui-smoke.cjs
```

The last additional gate deliberately stops only the verified local app, so run it with all other app activity finished:

```powershell
node --dns-result-order=ipv4first scripts/m0-image-job-recovery-smoke.mjs --run
```

The image UI harness preserves evidence on uncertainty. Its `--resume <absolute-report.json>` option verifies owner IDs/paths, original hashes and the original non-fixture baseline before continuing already accepted checks. Long runs pause between cases before OIDC expiry and use a fresh real session; they do not increase token lifetime or bypass authentication. Fixture paths containing reserved CQL characters are quoted, as required by the [SenseNet query syntax](https://docs.sensenet.com/api-docs/querying/).

## Manual smoke and rollout boundary

At `https://localhost:8080`, use the existing local Editor account:

1. Timeline → **List cover** → choose/order posters → **Generate preview** → **Publish**. After completion, change the selection and publish another preview.
2. Media → **Image sizes** → **Prepare sizes** → **Publish**. Check thumbnail/detail requests use the appropriate stored variant.
3. Open the list as Visitor: one generated image, preserved card appearance and mobile layout. For a recoverable error use **Retry publication** with the retained intent. Only an operator who verified the exact request stopped may use **Close failed attempt**.

No production content/state/config writes or deployment were performed. The old production publication and its physical upstream failure have not been inspected or resolved by these local results. After owner merge/deploy, verify a production sample and reconcile any old pending operation using its exact original owner/key/request proof; never edit the private fence or retry with a different key to bypass it.

Existing auth-state/token changes still remount open editors and cancel jobs of the old principal. This PR does not promise continuity across a token change; the long UI acceptance used verified independent authenticated case boundaries. External key-dependent providers and new cloud CAS behavior were not tested in this slice. Netlify function topology, the application-state binding/store and the existing conditional-write protocol are retained.
