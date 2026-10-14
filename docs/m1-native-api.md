# Native Timeline content API (M1)

The React UI and an independent HTTPS client use the same `/api/v1` routes, application plans, validation and target permissions in one Netlify app. Netlify Functions execute the application operations, and private Netlify Blobs hold its grants, plans, jobs, transfers, coordination and receipts. SenseNet remains the content repository and is accessed through its standard HTTP API. M1 does not install custom SenseNet .NET operations or change content types.

## Local startup

Requires Node 22.21 or newer, the existing isolated M0 repository and its trusted localhost certificate. Preserve existing volumes, accounts and snapshots. For an already provisioned M0 runtime:

```powershell
npm ci
npm ci --prefix client
./deployment/scripts/m0-runtime.ps1 -Action start
node scripts/m1-local-inventory-setup.cjs
npm run dev:m0
```

The explicit setup command creates one owned read-only inventory user and API key, grants only that identity read rights and explicit write denies at existing inheritance boundaries, verifies every project target, and stores its bound credential in ignored `deployment/.local/m1-inventory.json`. Reuse rechecks rights without writes. No startup, browsing, 404, authentication or transport failure provisions content. Production has no automatic provisioning.

UI: `https://localhost:8080`. API: `https://localhost:8080/api/v1`. Repository: `https://localhost:41016`; authority: `https://localhost:41017`; project: `/Root/Content/timelines`. The managed launcher runs one offline Netlify Dev app with its UI and Functions. Vite is the internal HTTP server on 5173; Netlify Dev terminates the public localhost HTTPS connection. There is no standalone application API to start.

Ordinary `npm run dev` and builds retain standard Vite `.env` precedence and configured hosting variables. Only `--local` selects M0 and its existing CA. For the local read-only smoke, stop the owned managed app and restart it with `node scripts/m1-dev.mjs --local --readonly`; discovery must report `readOnly: true` before that smoke proceeds. `npm run dev:readonly` selects the configured remote read-only profile without changing its repository or authority. TLS verification stays enabled.

Local app state is kept in ignored `deployment/.local/netlify-app-blobs` through the real Blobs SDK's local HTTP emulator, using a stable local site identifier. The local helper corrects SDK emulator ETag, conditional-write and listing behavior; it does not establish Netlify cloud atomicity. Deployment uses Netlify's managed private Blobs store, with no local filesystem persistence in a Function.

## Native connection and credentials

Public discovery: `GET /capabilities` and `GET /openapi.json` under the API base. Verify repository, authority and project before sending a credential. Every protected request supplies their exact `X-Timeline-Repository`, `X-Timeline-Authority`, and `X-Timeline-Project` headers.

An owner first calls `POST /grants` using an actual backend-authenticated credential. `X-Timeline-Backend-Auth: ApiKey` explicitly selects an owner-created SenseNet API key; otherwise a backend bearer token is used. Requested application scopes and lifetime are explicit. The Function verifies the real SenseNet identity and returns a random `tta_` token once. Its private Blobs record stores only the token hash and an underlying credential encrypted using key material derived from that original token; there is no global encryption-key file. The native client uses the token as `Authorization: Bearer ...`. The grant cannot exceed the underlying user's repository ACL. Lifetime is 60 seconds to 30 days; `POST /grants/{id}/revoke` lets a delegated token revoke itself. Revoking any other grant requires a current backend owner credential and matching backend identity.

First-party browser requests use the logged-in user's backend-validated token and configured frontend Origin. Same-origin GET can omit Origin, so the browser also supplies `X-Timeline-Client-Origin` with its exact frontend origin. These are routing constraints, not authentication; the backend credential is always verified. No administrator credential is substituted for a denied caller. Grant expiry/revocation and identity are rechecked before dispatch; exact Open/AddNew/Save/Delete and allowed-child-type rights remain authoritative.

The independent CLI is `scripts/m1-client.mjs`. It reads secrets from private files and refuses plaintext HTTP, redirects and mismatched discovery. Keep token files outside Git. `docs/examples/native-client.json` contains only the public local binding.

For the isolated M0 profile, prepare the existing editor API key without printing it. This reads only the ignored local accounts file and writes another ignored file; it issues no credential or repository write:

```powershell
$localAccounts = Get-Content deployment/.local/accounts.json -Raw | ConvertFrom-Json
[IO.File]::WriteAllText((Join-Path (Get-Location) 'deployment/.local/native-editor-key.txt'), $localAccounts.editor.apiKey)
```

In the example below, replace `C:/private/editor-backend-token.txt` with `deployment/.local/native-editor-key.txt` for M0, and choose new private grant/plan output filenames under `deployment/.local/`. Grant/plan file creation refuses to overwrite an existing file. Production uses an explicitly authorized backend credential provisioned by its owner.

```powershell
node scripts/m1-client.mjs discover --config docs/examples/native-client.json
node scripts/m1-client.mjs grant --config docs/examples/native-client.json --token-file C:/private/editor-backend-token.txt --backend-auth ApiKey --scopes content:read,timelines:write,media:write,entries:write --out C:/private/timeline-agent.json
node scripts/m1-client.mjs preview --config docs/examples/native-client.json --token-file C:/private/timeline-agent.json --input docs/examples/native-create.json --out C:/private/timeline-plan.json
# Inspect the returned diff, targets, effects and counts. Copy its id and choose a stable key:
node scripts/m1-client.mjs apply --config docs/examples/native-client.json --token-file C:/private/timeline-agent.json --plan RETURNED-PLAN-ID --key MY-SAVED-OPERATION-KEY
```

Save the plan ID and key before apply; the CLI requires an explicit stable `--key` and never silently generates a new retry key. A deliberate second occurrence uses a new create command/plan/key, even when its MediaItem is the same. Read/list, revoke, export and import-preview commands are also supported. OpenAPI is generated from the implemented routes and field rules.

Long plan previews, saved-plan applies, provider requests and ZIP export/import preparation return `202` with `{ "job": { "id": "...", "state": "queued" }, "pending": true }`. The browser and native client poll `GET /jobs/{id}` using the original credential and target binding. Completion reproduces the original HTTP status and result bytes, including non-2xx and partial results. A client wait exceeding 15 minutes keeps a recoverable job ID; it does not approve a replacement plan or apply key. `node scripts/m1-client.mjs job --config PUBLIC-CONFIG --token-file ORIGINAL-GRANT-FILE --id SAVED-JOB-ID` reads the current descriptor without another wait. A matching held writer exposes only its owned recovery plan/request IDs and requires explicit confirmation that the invocation has stopped. The owner can then use `recovery --plan SAVED-PLAN-ID --stopped-request CONFIRMED-STOPPED-REQUEST-ID` with a current backend credential. Only the exact original application principal may inspect or cancel a job with `POST /jobs/{id}/cancel` and `{}`. Private result reads recheck current backend identity, grant validity and Open rights for their saved content targets.

`GET /schemas/{type}` reports actual supported/writable fields and Choice options for Timeline, MediaItem, BookMediaItem and TimelineEntry. The production repository inspected through its MCP/HTTP read paths still lacks the optional `Year` and `SeriesName` fields that the local M0 schema supports. Reading older schemas works; a proposal writing an unavailable field fails whole-plan preflight instead of silently dropping it. Actual repository single/multiple Choice restrictions are also checked before any batch write. M1 performs no production schema migration.

Dates use real ISO calendar dates or timestamps with at most millisecond precision. Date-only and unzoned form input use UTC; zoned timestamps normalize to UTC in the reviewed plan. Unsupported year zero, midnight rollover and invalid calendar/clock values fail the entire preview before any write.

## Plans, conflicts and recovery

`POST /plans` accepts create/update/delete/order/metadata/cover commands. It validates the whole batch, target membership, actual ACL, full children/references and revisions, stores a private 15-minute plan, and returns a field diff, sources, delete effects and counts with `repositoryWrites: 0`. `POST /plans/{id}/apply` accepts an empty JSON object and required Idempotency-Key. The caller cannot replace approved fields at apply time.

Revisions are opaque `sha256:` snapshot hashes, including version/modification metadata and binary snapshot token. Timeline UI and native writes acquire a shared private Blobs writer using strong reads and conditional ETag updates. Its owner records a unique request ID, original principal and backend identity, plus the plan/job IDs when present. Full target preflight precedes the first write; writer ownership, cancellation, current identity, grant and target permissions are checked again at dispatch. A stale UI/agent plan returns conflict and preserves the newer manual edit.

The application writes durable private intent before repository dispatch and durable result after confirmation. Replaying a completed operation returns its original result, including the generated ID after a later rename. Following a lost response or Function restart, approved postconditions can reconcile an uncertain completed operation without another repository write. An absent or conflicting uncertain result is never resent automatically. Such an intent blocks unrelated application writes until its original caller checks the saved plan/key. An owner with a current backend credential can call `POST /recovery` with `{ "planId": "original-id" }` after plan/grant expiry; this reads current content and reconciles confirmed receipts, and never redispatches writes.

An interrupted invocation can leave the writer held. There is no elapsed-time lease, automatic takeover or retry of an already claimed background job. An operator must establish that the exact recorded invocation has stopped; the original backend identity can then explicitly submit `{ "planId": "original-id", "stoppedRequestId": "exact-stopped-request-id" }` to `POST /recovery`. That conditional release cannot free another invocation's writer. A still ambiguous repository outcome requires investigation. Cancellation is checked before subsequent writes; it does not undo confirmed writes.

Re-enqueueing a completed or confirmed-denied apply with the same original principal, plan and key returns its existing job/result. A different plan using that key conflicts. A confirmed `coordinator_busy` result before dispatch may reserve one new job. An explicit same-plan/key retry of a terminal uncertain receipt also reserves one new job to check the durable journal's postconditions; an uncertain recorded dispatch is never sent twice. Simultaneous explicit retries conditionally reserve one new job. Runtime retries of the original claim, running jobs, unconfirmed dispatch acknowledgments, cancellations, revision denial and confirmed partial outcomes never re-execute that job.

This is an application writer boundary. Direct SenseNet administration, scripts or MCP writes that bypass the app are outside its serialization guarantee. Every Timeline writer must use the same app API and shared Blobs state. Separate Function instances coordinate through that store, rather than process-local locks. The repository still has no application-wide atomic compare-and-swap; the separate SenseNet can be hosted anywhere reachable over trusted HTTPS.

Batches, full order and fields-plus-cover are not atomic. They return precise `completed`, `touchedIds`, `notApplied`, `notAppliedTargets` and `conflicted` results; HTTP 207 means partial completion. `retrySamePlan` and `uncertainTargets` mark an unconfirmed dispatch. Do not turn a partial result into an all-or-nothing success or retry it with a new key. Read-back precedes UI acknowledgment.

Create/rename collision checks, complete children and cross-timeline reference preflight require an explicitly configured read-only inventory identity covering every project node, including private nodes and broken inheritance. Its query selects IDs, parent IDs and types; caller snapshots and every mutation still use the caller credential. Hidden children cause a generic denial, and hidden reference IDs/content are not disclosed. Missing inventory disables operations requiring completeness. Verify coverage during provisioning and preserve that invariant when changing ACL externally; ACL-filtered stock queries cannot prove coverage of nodes from which the service has been excluded.

## Hosting and provider configuration

Deploy the UI and `native-api.mjs` / `native-api-background.mjs` Functions together in one Netlify app using the canonical root `netlify.toml`, which sets the build base to `client`. `/api/v1/*` is routed to that app's Function before SPA fallback; native clients use the same public origin plus `/api/v1`. Netlify provides public HTTPS. Production needs no custom API service, application database, host TLS-key paths or gateway origin setting.

`client/api/config.mjs` reads Function environment variables. Public target values must be available to the browser build and the Functions with the same repository, authority and project binding. Explicit Function overrides must still match discovery and every client request:

| Setting | Meaning |
| --- | --- |
| `VITE_SENSENET_REPO_URL`, `VITE_OIDC_AUTHORITY`, `VITE_PROJECT_ROOT_PATH` | Public target selection shared by the browser build and Function environment |
| `TIMELINE_REPOSITORY_URL`, `TIMELINE_AUTHORITY`, `TIMELINE_PROJECT_ROOT` | Optional explicit Function target overrides; must match the client binding |
| `TIMELINE_FRONTEND_ORIGIN` | Exact HTTPS app origin without path; otherwise the Netlify `DEPLOY_PRIME_URL` or `URL` supplies it |
| `TIMELINE_INVENTORY_CREDENTIAL` | Private Function-only JSON with `repositoryUrl`, `authority`, `projectRoot`, `state: "ready"`, positive numeric `identityId` and `credential: {mode,value}` |
| `TIMELINE_READ_ONLY` | Optional literal `true` or `false`; no target substitution |
| `TIMELINE_COVER_ORIGINS` | Optional comma-separated exact public HTTPS image origins in addition to the built-in providers |

The inventory identity is separately provisioned with project-wide read rights and explicit write denies. Configure its JSON as a private Netlify Function environment value; its binding must exactly match the selected repository, authority and project. The explicit local profile can read the already verified ignored `m1-inventory.json`. It is never an administrator fallback, a caller mutation credential or browser configuration. Missing/denied inventory remains a denial for operations needing completeness; startup and failures do not provision anything. Keep production read-only during the M1 validation scope.

Private Blobs records are bound to a hash of repository, authority and project. Grant credentials are encrypted; background input never stores raw authentication headers or backend tokens. Enqueue sends only a tiny saved-job-ID envelope and the allowed original authentication/binding headers over trusted HTTPS to the configured same-app background Function, with no caller-supplied invocation URL or redirect following. A permanent conditional claim prevents Netlify retry attempts from repeating execution. Preserve this app state across deployments; replacing it loses grant, retry and recovery history. Deployment Preview has an isolated app store.

The app budgets 55 seconds for foreground Functions and 895 seconds for background Functions, below Netlify's 60-second and 15-minute ceilings. The buffered JSON wire limit is 4 MiB; fully hydrated plan JSON is limited to 20 MiB, checked from manifests before reading binary chunks. Upload/download chunks are 2 MiB, inline results are at most 3 MiB, covers are at most 10 MiB, and ZIP archives are at most 64 MiB. Owned upload/download manifests expire after 15 minutes. Clients upload larger covers and ZIP inputs in checked chunks, use the resulting upload ID in preview, and reconstruct large private outputs from checked chunks and SHA-256 manifests. Every transfer and private result remains bound to the original principal and current target permissions. HTTP 202 means pending work, never successful application of a plan. Authentication, TLS, target-binding and repository failures never trigger direct backend writes.

Provider keys stay server-side. Configured `VITE_OMDB_KEY_PATH`, `VITE_TMDB_KEY_PATH`, and `VITE_TRAKT_KEY_PATH` are relative under `/(structure)/apikeys` inside the selected ECM project. Exact key content is read using the caller's actual Open rights only after required operation preflight. Optional Function-only `OMDB_API_KEY`, `TMDB_API_KEY`, `TRAKT_API_KEY`, and `GOOGLE_BOOKS_API_KEY` are also supported. Keyless Open Library is supported. No key is returned in results, provenance, logs or browser configuration. `node scripts/m1-dev.mjs --local --production-provider-keys` explicitly enables the test-only helper: three fixed production provider-key GETs use the already configured production MCP credential, then only the provider values enter the local Function process. The production credential does not enter app storage or provider requests. The option requires the isolated local profile and authorizes no production writes; normal startup performs none of those reads.

Metadata proposals include source URL, confidence and an uncertainty note. Missing-only is the default and preserves existing titles and other manual metadata. Overwrite is explicit and applies only selected reviewed fields. Editorial Name, Position, Notes, chronology and references remain protected from metadata enrichment. The browser saves exactly the reviewed proposal and prepared cover bytes, without refetching provider data at approval. Cover URL downloads validate public HTTPS origins and DNS/IP addresses, pin the validated address, bound time/bytes, reject redirects and never forward the repository credential.

ZIP exchange retains the active 19-column `timeline_data.tsv` plus PNG/JPEG/WebP covers. It requires existing local media IDs, preserves distinct occurrence Names and order, and rejects unsafe paths, duplicate members, conflicting covers for one shared media and oversized archives. It is not cross-repository portable backup. Missing optional covers are counted; identity/ACL failures abort.

See [operation parity and verification](m1-verification.md), [feature audit](feature-status-audit-2026-10-14.md), and the preserved [M1 commission](m1-agent-api-session-prompt-2026-10-14.md).
