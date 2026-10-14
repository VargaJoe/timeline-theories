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

For live providers, the explicit local `--production-provider-keys` launcher option reads exactly three existing production key nodes into local Function memory. It provides no production content credential to the app. Run `node scripts/m1-provider-live.mjs`; report provider failures separately. Do not create/link provider accounts during this gate.

The local Blobs SDK emulator needs documented compatibility fixes for conditional writes, ETags and Windows paths. Its tests do not prove cloud atomicity. `node scripts/m1-cloud-state-smoke.mjs --url VERIFIED-PR53-PREVIEW-ORIGIN` is restricted to the actual PR53 Deploy Preview. It sends public discovery GET and empty-JSON POST to `/__verification/storage`, with no credentials, MCP/config secret reads or SenseNet requests. The preview-only endpoint checks simultaneous first writes, strong reads, current/nonmatching/stale ETag conditions and cleanup of an internal UUID. One private claim/result per trusted deployment prevents repeated diagnostic writes. Callers cannot choose storage keys, values or ETags. Production exposes no verification endpoint.

## Current acceptance record

Netlify integration is being verified on `feature/m1-native-agent-api`, 2026-10-14. PR #53 remains draft until the new app/runtime gates are complete. Previous standalone/SQLite process results are superseded and are not Netlify acceptance evidence.

| Gate | Current result |
| --- | --- |
| Independent native HTTPS client | 24 passed on the shared 8080 app; CRUD/reuse, scoped/auth/ACL/expiry/revoke/binding deny, zero-write preview, real dates, metadata protection, complete order, stable retry, stale conflict, PNG ZIP and Open Library; cleanup 2998 |
| Whole-plan preflight | 10 passed on the shared app; hidden children, gained references, duplicate/late Name, invalid metadata, owner-only revoke; denied mixed plans write no earlier target; cleanup 2998 |
| Concurrent actual app requests | 3 passed; same plan/key shares one job and creates one ID, competing revisions yield one save/409, stored result replay; cleanup 2998 |
| SDK state / handler / transfer tests | 142 unit/contract tests passed, including real SDK HTTP, immutable state, cancellation, uncertainty retry, wire/large-envelope, credential-free preview selftest and OpenAPI/config checks. Controlled HTTPS fault test commits one PATCH, loses readback, then same-key retry reconciles with PATCH count still 1; this is explicitly not real SenseNet acceptance |
| UI/native Chromium | 7 passed on the shared app, waiting for actual terminal job responses; real native-created UI data, UI save read natively, pinned stale editor conflict, complete order; raw repository mutations 0 |
| M0 Chromium regression | 33 passed, including actual OIDC Visitor/Reader/Editor, create/edit/order/cover/ZIP, mixed permission preflight, Open revocation, logout and cleanup 2998; job responses are checked at completion |
| Large actual cover/ZIP | 5 passed; valid 6,294,468-byte RGB PNG and 12,590,252-byte ZIP, 11 upload/15 download chunks, exact hashes and real import referencing existing media; cleanup 2998 |
| Actual app restart | Pending |
| Real Deploy Preview CAS | Pending; emulator evidence alone is insufficient |
| Static, full source integrity and privacy | ESLint and three profile builds passed; final source integrity/privacy refresh pending |

Reports, screenshots, local grant files and runtime state remain ignored under `deployment/.local/`. Uncertain writes are checked with their saved plan/key. A stopped writer requires current original backend identity and exact stopped request confirmation; there is no clock-based takeover. Read-only recovery reconciles receipts but does not automatically resume a killed background job. Inspect its returned operations and explicitly review any remaining plan.

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

The configured Trakt credential previously returned `provider_auth_failed`; its API account access was inspected without account creation/linking. The exact cause is not proven. No mocked success replaces that provider failure. Google Books has not been exercised live. OMDb/TMDB/Open Library and cover/ZIP evidence will be refreshed on the new runtime.

Production read inspection found optional Year/SeriesName absent and Choice multiplicity different from M0. Unsupported field/choice writes fail the complete preflight. The production read-only inventory credential must be explicitly configured and verified in the app; missing coverage fails closed. No production content/schema/ACL migration, merge or production deployment is performed by these acceptance tests.
