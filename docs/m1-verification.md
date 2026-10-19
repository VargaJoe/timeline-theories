# M1 operation parity and verification

The native API runs in the existing Netlify app's Functions. UI and native clients share plans, validation, permission checks and receipts; SenseNet stores the content. Private app Blobs store grants, reviewed plans, jobs and durable results. All content-writing acceptance tests use the isolated M0 repository and owned UUID fixtures. Production SenseNet inspection is read-only.

## Operation map

| Operation | Shared code | Native route and actual rights |
| --- | --- | --- |
| Browse/search/page/detail | Stock snapshots and membership, nativeApi/timeline/media services | timelines/media/books/entries, content/lookup/snapshots; caller Open |
| Timeline/media/book create/edit/delete | domain/content, api/plans and stock-repository | plans then saved apply; parent AddNew + allowed type, target Save/Delete, complete descendants/references |
| Distinct occurrences reusing media | entry services and shared field validation | TimelineEntry create/update/delete; timeline AddNew, referenced media Open, occurrence Save/Delete |
| Notes/chronology/labels/arc/importance | entry editor, real ISO date and Choice rules | update with pinned expectedRevision and exact Save |
| Complete order | exact membership/inventory and per-entry revisions | order command; every current occurrence Open + Save |
| Binary/URL covers | bounded owned transfers, standard upload, guarded public URL fetch | cover/metadata command; covers:write and target Save; reads recheck Open |
| Metadata proposals and approval | missing-only or explicit overwrite, reviewed source/data/cover | providers/media/lookup then metadata plan; Save checked before provider fetch |
| Media/book/Trakt providers | fixed transports and private key loading | providers/*; scopes and backend rights before each fetch |
| Active ZIP import/export | shared 19-column TSV format and safe archive bounds | exchange export/preview then apply; existing local media IDs, every target/create/cover right |
| Grants/revoke/recovery | encrypted credentials, original principal, durable intents | grants/revoke/recovery; current backend identity and exact owned plan/request |
| Jobs/chunks | private app Blobs and conditional claims | jobs, uploads, downloads; original principal, current credential and exact target permissions |

Clone/fork, new account synchronization, universe models, trending/discovery and lossless cross-repository backup remain deferred. Batches, full order and fields plus cover are not backend transactions. App writers share the Blobs coordinator; direct repository administrators remain outside that boundary.

## Verification commands

For an already provisioned/restored M0 repository, run one managed app:

```powershell
npm ci
npm ci --prefix client
npm run dev:m0
```

In a second terminal, run fixture gates sequentially:

```powershell
npm test
npm run test:parity
npm run lint
npm run build
npm run build:readonly --prefix client
npm run build:m0 --prefix client
node scripts/m1-native-smoke.mjs --providers
node scripts/m1-preflight-smoke.mjs
node scripts/m1-concurrency-smoke.mjs --run
node scripts/m1-large-transfer-smoke.mjs --run
node scripts/m1-browser-api-smoke.cjs
node scripts/m0-browser-smoke.cjs
```

Restart verification uses the exact managed Netlify CLI Node PID, keeps private app Blobs, and must resume before the printed saved-plan expiry:

```powershell
node scripts/m1-restart-smoke.mjs --prepare --app-pid OWNED-CLI-PID
# Restart only the owned app process tree, preserving deployment/.local.
node scripts/m1-restart-smoke.mjs --resume --app-pid NEW-OWNED-CLI-PID
```

For the readonly gate, stop only the owned managed app and restart it with `node scripts/m1-dev.mjs --local --readonly`; then run `node scripts/m1-readonly-smoke.mjs`. Restore the normal `--local` app afterwards. This checks actual HTTPS denial and unchanged content; handler tests separately verify zero write dispatch.

Ordinary configured dev is separately checked with `node scripts/m1-dev.mjs --readonly`, without `--local`, followed by `node scripts/m1-configured-dev-smoke.mjs`. The script compares discovery with the browser's public Vite profile, checks app storage and acknowledges a credential-free synthetic background HTTPS request. No authenticated job or repository write runs. It preserves the selected `.env`/mode/process targets, rather than assuming they point at production. Restore the explicit M0 app afterwards.

For live providers, the explicit local `--production-provider-keys` launcher option reads exactly three existing production key nodes into local Function memory. It provides no production content credential to the app. Run `node scripts/m1-provider-live.mjs`; report provider failures separately. Do not create/link provider accounts during this gate.

The local Blobs SDK emulator needs documented compatibility fixes for conditional writes, ETags and Windows paths. Its tests do not prove cloud atomicity. `node scripts/m1-cloud-state-smoke.mjs --url VERIFIED-PR53-PREVIEW-ORIGIN` is restricted to the actual PR53 Deploy Preview. It sends public discovery GET and empty-JSON POST to `/__verification/storage`, with no credentials, MCP/config secret reads or SenseNet requests. The preview/development endpoint checks simultaneous first writes, strong reads, current/nonmatching/stale ETag conditions and cleanup of an internal UUID. One private claim/result per trusted deployment prevents repeated diagnostic writes. Callers cannot choose storage keys, values or ETags. Production exposes no verification endpoint.

## Current acceptance record

The Netlify app acceptance record began on `feature/m1-native-agent-api`, 2026-10-14, for [PR #53](https://github.com/VargaJoe/timeline-theories/pull/53). Refreshed 2026-10-15 results are identified below; the unchanged restart, readonly, configured-dev and live-provider gates retain their 2026-10-14 evidence. UI and API use the same app runtime. The earlier standalone/SQLite results are superseded; this record reports the integrated app's tests. Merge and production deployment remain Joe's decision.

The 2026-10-15 agent review independently reproduced and fixed three issues: a form/import retry could generate another create Name after a lost response; successful exact-node writes unnecessarily required Open on the library root when reading their receipt; and a whole preview could reserve the same destination for a create and rename. Each form/import occurrence now retains its identity, original input, Name and saved plan/key once apply starts. Preparation failures still permit corrected input. Completed import rows and callback failures retain their results; a deliberate new form creates a distinct occurrence. Receipts check surviving exact targets, while deletion fallback permission is checked before any write. Create and rename destinations share case-insensitive reservations. Trakt numeric provider IDs are normalized to the existing string-valued ExternalLinks contract.

The fresh internal reviewer accepted all three fixes and independently passed the 19 frontend retry/import and 22 backend planner/Function tests. This is an internal code review, not a submitted GitHub approval. The new isolated tests use actual transpiled services and the installed SDK with controlled HTTP; real repository/browser acceptance remains separately reported below.

| Gate | Current result |
| --- | --- |
| Independent native HTTPS client | 24 passed on the shared 8080 app, refreshed 2026-10-15; CRUD/reuse, scoped/auth/ACL/expiry/revoke/binding deny, zero-write preview, real dates, metadata protection, complete order, stable retry, stale conflict, PNG ZIP and Open Library; cleanup 2998 |
| Whole-plan preflight | 13 passed on the shared app, refreshed 2026-10-15; hidden children, gained references, duplicate/late Name, both create/rename orders and case-insensitive two-rename collision, invalid metadata, owner-only revoke; denied mixed plans write no earlier target; cleanup 2998 |
| Concurrent actual app requests | 3 passed, refreshed 2026-10-15; same plan/key shares one job and creates one ID, competing revisions yield one save/409, stored result replay; cleanup 2998 |
| SDK state / handler / transfer tests | 176 unit/contract tests passed, refreshed 2026-10-15, including the review regressions, real SDK HTTP, immutable state, cancellation, uncertainty retry, wire/large-envelope, credential-free selftest, structured provider errors, configured-dev TLS and OpenAPI/config checks. Controlled HTTPS fault tests commit one PATCH and recover a lost readback without another PATCH, and return/replay a successful exact-node update with library-root Open denied; this is explicitly not real SenseNet acceptance |
| UI/native Chromium | 10 passed on the shared app, refreshed 2026-10-15, waiting for actual terminal job responses; real native-created UI data, UI save read natively, pinned stale editor conflict, complete order. A successful real create receipt is dropped only after independent native/repository ownership reads; retrying the original form reuses the exact plan/key and one ID, while a new form with identical fields creates a distinct occurrence. Strict local CA trust remains enabled for both Chromium and Node interception; raw repository mutations 0, cleanup 2998 |
| M0 Chromium regression | 33 passed, refreshed 2026-10-15, including actual OIDC Visitor/Reader/Editor, create/edit/order/cover/ZIP, mixed permission preflight, Open revocation, logout and cleanup 2998; job responses are checked at completion |
| Large actual cover/ZIP | 5 passed, refreshed 2026-10-15; valid 6,294,468-byte RGB PNG and 12,590,252-byte ZIP, 11 upload/15 download chunks, exact hashes and real import referencing existing media; cleanup 2998 |
| Actual app restart | 6 passed after managed CLI43936→58784; four completed create/update/order/delete HTTP bodies discarded, exact original job/plan/key receipts recovered, renamed ID preserved, stale409; cleanup5, final2998. This does not simulate a killed in-flight repository writer |
| Actual readonly app | 4 passed; exact isolated target, scoped reads, writer plan denied with unchanged revision, temporary grant revoked |
| Ordinary configured dev | 3 passed; discovery matches the existing public env profile, private app CAS/cleanup and actual HTTPS background acknowledgement work with no credentials or authenticated content job |
| Real Deploy Preview CAS | Passed on the actual PR53 preview: one concurrent first-write winner, strong reads, wrong/current/stale CAS and owned cleanup verified by cloud Blobs. Credential-free diagnostic sends zero SenseNet requests/writes |
| Live provider workflows | 8 passed for OMDb/TMDB/Open Library, approved metadata preserving manual title, real book creation, URL-only cover and ZIP. Overall provider report is false only because Trakt returns502/provider_auth_failed; cleanup4, final2998 |
| Static, full source integrity and privacy | Root/client npm ci without force or legacy passed; ESLint and three profile builds refreshed 2026-10-15. Full2998-record/1503-binary-field source verify has zero field/reference/binary/order mismatches. Known-secret scan128 reviewed files has zero matches; official preservation script freshly verified all18 legacy/env/certificate files,631641439 bytes, unchanged |

Reports, screenshots, local grant files and runtime state remain ignored under `deployment/.local/`. Uncertain writes are checked with their saved plan/key. A stopped writer requires current original backend identity and exact stopped request confirmation; there is no clock-based takeover. Read-only recovery reconciles receipts but does not automatically resume a killed background job. Inspect its returned operations and explicitly review any remaining plan.

## Production visitor regression, 2026-10-19

After PR #53 was merged, the production repository returned HTTP 200 with an empty `GetSchema` array to anonymous callers. Public content GETs were allowed, but the native snapshot reader unnecessarily required schema visibility and returned `503 / backend_schema_unavailable`, breaking the timeline list. The separate `HasPermission?permissions=AddNew` denial was a permission probe, not a creation request.

Reads now check the exact target's application membership and caller Open rights, retrieve that caller-authorized content, and project only the application field allowlist. Supported optional fields and snapshot revisions are preserved. Field-write preflight and explicit schema discovery still require the actual schema; credentials, ACLs and production content are unchanged. Anonymous write-permission checks now stop locally before readiness, ACL or mutation requests.

Verification: 180 unit/contract tests, 55 parity checks, lint and all three builds passed. Four controlled HTTPS regressions cover empty-schema reads, safe projection, optional fields, denied Open and schema-dependent field writes. The modified stock reader also successfully read real public production timelines and an occurrence using only anonymous GETs, with zero GetSchema calls or repository writes. A readonly local app rendering the real production timeline list was checked in Chromium; production publication is a separate operator step.

## Hungarian manual smoke

1. `npm run dev:m0` indítsa a közös appot. A localhost:8080 UI és `/api/v1` ugyanazt a repository/auth/project kötést mutassa a CLI `discover` eredményével. A korábbi `.env`, account, cert és source snapshot maradjon meg.
2. `Login with IdentityServer` → M0Editor. A helyi jelszót a private accountfájlból használd. Saját writer granttal készíts elő, nézz át, majd alkalmazz egy új timeline/media tervet.
3. Két külön create operationnel add ugyanazt a médiát a timeline-hoz. Reload után két eltérő előfordulás látszódjon. `Edit Entry` → `Save Changes` csak az egyik Notes mezőjét módosítsa; native read ugyanazt mutassa.
4. Native preview után módosítsd az entryt az UI-ban. A régi terv apply-ja 409 legyen, a kézi módosítás megmaradjon. `Save New Order` után UI reload és native list azonos sorrendet adjon.
5. Metadata preview mutassa a forrásokat/diffet; missing-only őrizze a kézi Title/Description mezőket. Jóváhagyás a tényleges végső eredményt várja meg. Providerhiba egyértelműen jelenjen meg.
6. Nagy borító/ZIP esetén a háttérmunka és chunk átvitel után a pontos bájtok érkezzenek vissza. Saját második timeline-ba importált ZIP külön előfordulás-Name-eket és a meglévő local media-ID-t használjon.
7. Ugyanaz a mentett plan/key eredeti ID/nyugta legyen, más plan ugyanazzal a keyvel konfliktus. Revoked grant 401, Reader/readonly írási deny legyen.
8. A saját előfordulásokat/timeline-okat töröld a média előtt. Hivatkozott média törlése 409. A teszt végén ne maradjon saját fixture; a forrásadatok maradjanak meg.

## Provider and production limits

The configured Trakt credential returns `502 / provider_auth_failed` through the actual app's background job and native client; provider status/code/source/retry advice are preserved. Its API account access was inspected without account creation/linking. The exact cause is not proven. No mocked success replaces that provider failure. Google Books has not been exercised live. OMDb/TMDB/Open Library and actual metadata/book/cover/ZIP workflows passed on the integrated runtime.

Production read inspection found optional Year/SeriesName absent and Choice multiplicity different from M0. Unsupported field/choice writes fail the complete preflight. The production read-only inventory credential must be explicitly configured and verified in the app; missing coverage fails closed. No production content/schema/ACL migration, merge or production deployment is performed by these acceptance tests.

The final clean install reports 10 runtime dependency advisories (7 moderate, 3 high), affecting the existing SenseNet/OIDC/Quill/Router dependency tree. Including development tooling reports26 (7 moderate,19 high). npm proposes incompatible major changes or old-version substitutions; no `npm audit fix --force` was used. This milestone does not claim a zero-advisory dependency audit.
