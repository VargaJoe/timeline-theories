# Native Timeline content API (M1)

The React UI and an independent HTTPS client use the same application plans, validation, target permissions and mutation gateway. SenseNet remains a separate content repository. The gateway uses its standard HTTP API; M1 does not install custom SenseNet .NET operations or change content types.

## Local startup

Requires Node 22.21 or newer with `node:sqlite`, the existing isolated M0 repository and its trusted localhost certificate. Preserve existing volumes, accounts and snapshots. For an already provisioned M0 runtime:

```powershell
npm ci
npm ci --prefix client
./deployment/scripts/m0-runtime.ps1 -Action start
node scripts/m1-local-inventory-setup.cjs
npm run api:local
# A second terminal:
npm run dev:m0
```

The explicit setup command creates one owned read-only inventory user and API key, grants only that identity read rights and explicit write denies at existing inheritance boundaries, verifies every project target, and stores its bound credential in ignored `deployment/.local/m1-inventory.json`. Reuse rechecks rights without writes. No startup, browsing, 404, authentication or transport failure provisions content. Production has no automatic provisioning.

UI: `https://localhost:8080`. API: `https://localhost:8081/api/v1`. Repository: `https://localhost:41016`; authority: `https://localhost:41017`; project: `/Root/Content/timelines`. Ordinary dev/build still use standard Vite `.env` precedence and hosting variables; optional read-only disables writes without changing the target.

## Native connection and credentials

Public discovery: `GET /capabilities` and `GET /openapi.json` under the API base. Verify repository, authority and project before sending a credential. Every protected request supplies their exact `X-Timeline-Repository`, `X-Timeline-Authority`, and `X-Timeline-Project` headers.

An owner first calls `POST /grants` using an actual backend-authenticated credential. `X-Timeline-Backend-Auth: ApiKey` explicitly selects an owner-created SenseNet API key; otherwise a backend bearer token is used. Requested application scopes and lifetime are explicit. The gateway verifies the real SenseNet identity, stores the underlying credential encrypted, and returns a random `tta_` token once. The native client uses that token as `Authorization: Bearer ...`. The grant cannot exceed the underlying user's repository ACL. Lifetime is 60 seconds to 30 days; `POST /grants/{id}/revoke` lets a delegated token revoke itself. Revoking any other grant requires a current backend owner credential and matching backend identity.

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

`GET /schemas/{type}` reports actual supported/writable fields and Choice options for Timeline, MediaItem, BookMediaItem and TimelineEntry. The production repository inspected through its MCP/HTTP read paths still lacks the optional `Year` and `SeriesName` fields that the local M0 schema supports. Reading older schemas works; a proposal writing an unavailable field fails whole-plan preflight instead of silently dropping it. Actual repository single/multiple Choice restrictions are also checked before any batch write. M1 performs no production schema migration.

Dates use real ISO calendar dates or timestamps with at most millisecond precision. Date-only and unzoned form input use UTC; zoned timestamps normalize to UTC in the reviewed plan. Unsupported year zero, midnight rollover and invalid calendar/clock values fail the entire preview before any write.

## Plans, conflicts and recovery

`POST /plans` accepts create/update/delete/order/metadata/cover commands. It validates the whole batch, target membership, actual ACL, full children/references and revisions, stores a private 15-minute plan, and returns a field diff, sources, delete effects and counts with `repositoryWrites: 0`. `POST /plans/{id}/apply` accepts an empty JSON object and required Idempotency-Key. The caller cannot replace approved fields at apply time.

Revisions are opaque `sha256:` snapshot hashes, including version/modification metadata and binary snapshot token. All Timeline UI and native writes pass through a persistent SQLite transaction lock. Independent gateway processes on the same host share the same data directory and real database lock. Full target preflight precedes the first write, and each target is checked again at dispatch. A stale UI/agent plan returns conflict and preserves the newer manual edit.

The application writes durable intent before repository dispatch and durable result after confirmation. Replaying a completed operation returns its original result, including the generated ID after a later rename. Following a lost response or restart, approved postconditions can reconcile an uncertain completed operation without another repository write. An absent or conflicting uncertain result is never resent automatically. Such an intent blocks unrelated application writes until its original caller checks the saved plan/key. An owner with a current backend credential can call `POST /recovery` with `{ "planId": "original-id" }` after plan/grant expiry; this only reads current content and reconciles confirmed receipts, and never redispatches writes. A still ambiguous outcome requires operator investigation.

This is an application writer boundary. Direct SenseNet administration, scripts or MCP writes that bypass the gateway are outside its serialization guarantee. Deploy every Timeline writer against the same persistent gateway; do not keep an old client writing directly. SQLite coordination is for one host with a local persistent filesystem, not independent serverless instances or multi-host network storage. The separate SenseNet can be hosted anywhere reachable over trusted HTTPS.

Batches, full order and fields-plus-cover are not atomic. They return precise `completed`, `touchedIds`, `notApplied`, `notAppliedTargets` and `conflicted` results; HTTP 207 means partial completion. `retrySamePlan` and `uncertainTargets` mark an unconfirmed dispatch. Do not turn a partial result into an all-or-nothing success or retry it with a new key. Read-back precedes UI acknowledgment.

Create/rename collision checks, complete children and cross-timeline reference preflight require an explicitly configured read-only inventory identity covering every project node, including private nodes and broken inheritance. Its query selects IDs, parent IDs and types; caller snapshots and every mutation still use the caller credential. Hidden children cause a generic denial, and hidden reference IDs/content are not disclosed. Missing inventory disables operations requiring completeness. Verify coverage during provisioning and preserve that invariant when changing ACL externally; ACL-filtered stock queries cannot prove coverage of nodes from which the service has been excluded.

## Hosting and provider configuration

Run `npm run api` as a persistent Node service. `server/config.mjs` reads the same public Vite target selection as the normal client. Explicit server overrides are `TIMELINE_REPOSITORY_URL`, `TIMELINE_AUTHORITY`, and `TIMELINE_PROJECT_ROOT`; discovery and request binding must still match the client. Required private server settings:

| Setting | Meaning |
| --- | --- |
| `TIMELINE_FRONTEND_ORIGIN` | Exact HTTPS frontend origin, without path |
| `TIMELINE_DATA_DIR` | Absolute persistent private directory containing SQLite and encryption key; same directory for all gateway processes on one host |
| `TIMELINE_TLS_KEY`, `TIMELINE_TLS_CERT` | Absolute trusted gateway TLS key/certificate paths |
| `TIMELINE_INVENTORY_FILE` | Private JSON with repositoryUrl, authority, projectRoot, state `ready`, inventory identityId and credential `{mode,value}`; verify actual read-only rights |
| `TIMELINE_REPOSITORY_CA` | Optional trusted private repository CA file; TLS verification is always enabled |
| `TIMELINE_LISTEN_HOST`, `TIMELINE_PORT` | Default `127.0.0.1`, `8081` |
| `TIMELINE_MODE` | Vite env mode for normal server target loading; default development |
| `TIMELINE_READ_ONLY` | Optional literal `true` or `false`; no target substitution |
| `TIMELINE_COVER_ORIGINS` | Optional comma-separated exact public HTTPS image origins in addition to the built-in providers |

The inventory file is a separately provisioned minimally privileged identity, never an administrator fallback. Secure the data directory/encryption key and private files with host ACLs, keep them out of Git, and back them up together. Losing this state loses grant/retry history; do not replace it with process-local caches.

Netlify hosts the SPA and `client/netlify/functions/native-api.cjs` forwards the fixed `/api/v1` route to `TIMELINE_GATEWAY_ORIGIN`, an operator-set public HTTPS origin. `_redirects` places this route before SPA fallback. The function holds no backend owner credential and forwards only allowed request/auth/binding headers. Its 4 MiB request/response and 25-second deadline are stricter than the direct gateway's 20 MiB JSON/10 MiB cover/64 MiB ZIP limits. Use a directly configured `VITE_NATIVE_API_URL=https://gateway.example/api/v1` and the gateway frontend Origin for larger transfers. An undeployed gateway keeps confirmed ordinary read paths available and disables writes; auth, TLS, target binding and repository failures never trigger a raw write fallback.

Provider keys stay server-side. Configured `VITE_OMDB_KEY_PATH`, `VITE_TMDB_KEY_PATH`, and `VITE_TRAKT_KEY_PATH` are relative under `/(structure)/apikeys` inside the selected project. Exact key content is read using the caller's actual Open rights only after required operation preflight. Optional server-only `OMDB_API_KEY`, `TMDB_API_KEY`, `TRAKT_API_KEY`, and `GOOGLE_BOOKS_API_KEY` are also supported. Keyless Open Library is live. No key is returned in results, provenance, logs or browser configuration. The explicit local test option `--production-provider-keys` performs read-only fixed provider-key reads through the already configured production MCP credential; it cannot be enabled for a nonlocal gateway and does not authorize production writes.

Metadata proposals include source URL, confidence and an uncertainty note. Missing-only is the default and preserves existing titles and other manual metadata. Overwrite is explicit and applies only selected reviewed fields. Editorial Name, Position, Notes, chronology and references remain protected from metadata enrichment. The browser saves exactly the reviewed proposal and prepared cover bytes, without refetching provider data at approval. Cover URL downloads validate public HTTPS origins and DNS/IP addresses, pin the validated address, bound time/bytes, reject redirects and never forward the repository credential.

ZIP exchange retains the active 19-column `timeline_data.tsv` plus PNG/JPEG/WebP covers. It requires existing local media IDs, preserves distinct occurrence Names and order, and rejects unsafe paths, duplicate members, conflicting covers for one shared media and oversized archives. It is not cross-repository portable backup. Missing optional covers are counted; identity/ACL failures abort.

See [operation parity and verification](m1-verification.md), [feature audit](feature-status-audit-2026-10-14.md), and the preserved [M1 commission](m1-agent-api-session-prompt-2026-10-14.md).
