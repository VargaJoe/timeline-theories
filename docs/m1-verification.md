# M1 operation parity and verification

The milestone uses a real standalone HTTPS application gateway and stock SenseNet HTTP API. All content-writing acceptance probes run against the isolated localhost M0 repository, with UUID fixtures and cleanup. Production SenseNet MCP is used only for read-only schema/content/provider-key inspection. Production deployment and credential/ACL provisioning remain Joe's work.

## Operation map

| Operation | UI path | Shared domain / gateway | HTTP route and actual rights | Evidence |
| --- | --- | --- | --- | --- |
| Browse/search/page/detail | Timeline/media services, guarded `repository.fetch/load` | Membership validation, stock snapshots, opaque revision | timelines/media/books/entries GET; content/lookup/snapshots; exact Open, caller-filtered pages | Native HTTP, M0 browser/privacy/reference gates |
| Timeline create/edit/visibility/delete | timelineService, TimelineViewPage | content field validation, saved plans, complete descendants | plans create/update/delete; parent AddNew+type, target Save/Delete, every child Delete | Stock15, native22, browser gates |
| Media/book create/update/delete | mediaLibraryService, book import/edit | same field rules and plan path | plans; AddNew/Save/Delete, actual schema, complete media references/leaf preflight | Stock15, native22, live Open Library book |
| Reuse distinct occurrences | entry create/select/edit/delete | TimelineEntry fields, project media reference, unique Name | plans; timeline AddNew, referenced media Open, occurrence Save/Delete | Native HTTP creates two IDs for one media; browser reload/edit proof |
| Notes/chronology/labels/arc/importance | TimelineEntryEditModal | field/date/choice validation | update with expectedRevision and exact Save | Native22, browser gates |
| Complete order | TimelineViewPage `Save New Order` | exact full inventory, membership and every revision | order command; every current child Open+Save | Stock15, native22, real two-process contention and browser order |
| Binary/URL cover | mediaLibraryService, timeline cover, import | signature/byte limits, standard upload, guarded public URL fetch | cover/metadata command; target Save, covers:write; content/{id}/cover exact Open | Stock exact bytes, native ZIP bytes, live cover/ZIP gate |
| Metadata proposal/preview/apply | BulkUpdateDialog, mediaUpdateService | metadataDiff, missing-only/explicit overwrite, source confidence/uncertainty; exact reviewed bytes/data | providers/media/lookup + metadata plan; metadata:write, target Save before provider/image fetch | 14 parity checks, native manual-field preservation, live provider gate |
| Provider media/book/Trakt list | provider/browser adapters | bounded fixed provider transports, server-only key loading | providers/*; application scopes and actual library/media rights before fetch | Live provider report; Trakt result recorded separately |
| Active ZIP import/export | timelineImportService, timelineExportService | one import batch; shared 19-column format, strict bounds, media-ID references, cover dedup | exchange/{id}/export/preview then saved apply; every target/create/cover right preflight | 20 exchange tests, native real PNG ZIP, M0 browser gate |
| Native grant/revoke/recovery | independent `m1-client.mjs` | backend identity validation, encrypted credential, explicit scopes/binding, durable receipts | grants/revoke/recovery; self-revoke or actual backend owner | Native22, two-process/restart gates |

Unimplemented stories in the feature audit remain deferred: clone/fork, new social-login/account sync, universe/cross-reference models, rating/trending/discovery, publisher feed sync and lossless cross-repository backup. The capability endpoint does not advertise them.

## Verification commands

Run fixture-writing gates sequentially against the already restored isolated repository. The HTTP gates require `npm run api:local`; browser gates also require `npm run dev:m0`.

```powershell
npm ci
npm ci --prefix client
npm test
npm run lint
npm run build
npm run build:m0 --prefix client
npm run build:readonly --prefix client
node scripts/test-metadata-parity.mjs
node scripts/test-native-read-availability.mjs
node scripts/test-native-receipts.mjs
node scripts/m1-readonly-smoke.mjs
node scripts/m1-native-smoke.mjs --providers
node scripts/m1-preflight-smoke.mjs
node scripts/m1-concurrency-smoke.mjs --run
# Capture the actual owned gateway PID, then:
node scripts/m1-restart-smoke.mjs --prepare --gateway-pid OWNED-PID
# Restart only that owned gateway process, preserving its data directory.
node scripts/m1-restart-smoke.mjs --resume --gateway-pid NEW-OWNED-PID
node scripts/m1-restart-smoke.mjs --pending --gateway-pid NEW-OWNED-PID
node scripts/m1-provider-live.mjs
node scripts/m1-browser-api-smoke.cjs
npm run test:backend
npm run test:privacy
npm run test:reference
npm run test:auth-storage
npm run test:browser
node scripts/m0-restore.cjs deployment/.local/snapshots/2026-10-13T14-32-10-703Z --verify
./deployment/scripts/m0-preservation.ps1
```

Evidence reports and browser screenshots live under ignored `deployment/.local/`; they include safe counts, routes and results, never credentials. Restart evidence distinguishes completed durable receipt replay from an unconfirmed upstream commit; it does not claim a backend transaction, automatic partial-order resume or direct administrator writer protection. The gateway's durable pending fence/recovery rule is described in [M1 API operations](m1-native-api.md).

## Hungarian manual smoke

1. Indítsd a helyi API-t és `dev:m0` UI-t. A normál `.env` fájlokat hagyd meg; a helyi profil kiválasztása explicit. A CLI `discover` mutassa pontosan a localhost repository/auth/project kötést.
2. `Login with IdentityServer` → M0Editor. A jelszót az ignored helyi accountfájlból használd, ne másold chatbe. A CLI-vel adott writer credential és create terv hozzon létre saját, könnyen felismerhető timeline-t és médiát.
3. Két külön create operationnal add ugyanazt a médiát a timeline-hoz. `/timelines/<Name>` újratöltése után két előfordulás legyen, külön Notes/chronology mezőkkel. `Edit Entry` → `Save Changes`: csak az egyik módosuljon; native read ugyanazt mutassa.
4. Native preview után szerkeszd ugyanazt az entryt az UI-ban, majd alkalmazd a régi native tervet. 409 konfliktus, a kézi UI-módosítás maradjon meg. A teljes sorrendet `Save New Order` mentse; újratöltés és native list ugyanazt a Position-sorrendet adja.
5. Metadata preview mutassa a forrásokat és diffet, a meglévő kézi Title/Description ne módosuljon missing-only módban. Csak a jóváhagyott mezők/borító mentődjenek. Providerhiány vagy hibás provider-hitelesítés egyértelmű hiba legyen.
6. Exportálj ZIP-et, majd importáld saját második teszt-timeline-ba. Két külön Name és ugyanaz a local media-ID maradjon; a PNG/URL borító látszódjon. A ZIP nem hordozható más repositoryba.
7. Ugyanazt a mentett plan/key párost küldd újra: eredeti ID/eredmény, nincs másolat vagy új mentés. Más payload ugyanazzal a keyvel konfliktus. A revoked token olvasásra is 401-et kapjon; Reader/readonly ne küldjön írást.
8. Előbb töröld a saját occurrence-okat és timeline-okat, utána a médiát. Hivatkozott média törlése 409. Logout után új tesztcontent ne maradjon, a forrásadatok és korábbi listák maradjanak meg.

## Current acceptance record

Validated on `feature/m1-native-agent-api`, 2026-10-14, with strict trusted HTTPS against the isolated M0 repository. Source inspection, adapter tests and health checks alone are not end-to-end acceptance.

| Gate | Actual result |
| --- | --- |
| Unit / shared contract | 77 passed, including 20 exchange and 6 shared content-domain cases |
| UI/native adapter parity | 14 metadata + 25 read availability + 6 partial/uncertain receipt checks passed |
| Static / profiles | ESLint and normal, readonly and explicit M0 builds passed; existing bundle-size/dynamic-import warnings remain |
| Independent native HTTPS client | 24 passed: scoped Reader/Writer, revoked/expired/wrong-binding denial, real CRUD/reuse, metadata/manual protection, full order, actual PNG ZIP, stale conflict, stable retry, calendar validation and zoned readback |
| Actual Chromium UI/native proof | 7 passed; native-created data visible in UI, UI save visible natively, stale open UI editor conflicts despite cache refresh; raw repository writes 0 |
| Actual M0 Chromium regression | 33 passed; Visitor/Reader apply POSTs 0, Editor 15 native applies, raw repository mutations 0; cleanup succeeded |
| M0 backend / privacy / reference | 13 + 46 + 74 passed; real OIDC/Visitor and private reference/binary coverage |
| Authentication storage | Actual Chromium profile/tab/reopen storage isolation passed; does not claim an SNAuth server login |
| Whole-plan preflight | 10 passed: grant ownership/revoke, hidden children, gained references, duplicate/late-claimed Names, empty metadata; denied mixed plans saved no earlier target |
| Two independent gateway processes | 4 passed, including direct confirmation of the held SQLite lock and cross-process stored receipt replay |
| Actual gateway restart / pending recovery | 6 restart + 4 pending/expired-owner-recovery checks passed; no redispatch and original content IDs preserved |
| Actual readonly HTTPS gateway | 4 passed, same target readable, repository writes 0 and no Save probe/mutation intent for denied update |
| Independent CLI input guards | Documented discovery worked; missing stable apply key and encoded plan traversal rejected before a mutating request |

All fixture-writing native/browser/provider/coordination/preflight gates restored the source count to **2998**, with ownership-checked UUID cleanup. Native accepted-path cleanup used application API deletes. Actual M0 backend regression fixtures use their original guarded local cleanup. No production content, ACL or schema mutation was performed.

The final full snapshot verification passed for all **2998 records and 1503 binary fields**: field/reference/order/binary mismatches all **0**, against `2026-10-13T14-32-10-703Z`. The original **18 legacy/environment/certificate files** retained their SHA256 hashes. The final file-content privacy scan covered **103 reviewed candidate files**, with **0 known-secret matches**; runtime accounts, inventory credentials, grant tokens, database/certificates, reports and build artifacts are ignored. This checks the committed file contents; it does not rewrite Git author metadata or history.

Latest ignored reports: `m1-native-report.json`, `m1-preflight-report.json`, `m1-readonly-report.json`, `m1-concurrency-report.json`, `m1-restart-report.json`, `m1-pending-recovery-report.json`; UI proof `m1-browser-api-smoke/23a3e6c0-5774-4421-844f-cfb329f086b0/report.json`; M0 browser `browser-smoke/5f285aa0-1066-4efd-b32f-7f019967a659/report.json`, all under `deployment/.local/`.

### Live provider and production limits

Eight actual provider workflow checks passed: OMDb and TMDB metadata/provenance, zero-write lookup, selected TMDB apply preserving manual fields, Open Library search/detail/local BookMediaItem, URL-only cover (87,458 actual WebP bytes), cover-containing native ZIP (88,399 bytes) and cleanup. The overall `m1-provider-live-report.json` intentionally remains **passed: false** because the stored Trakt credential returned `provider_auth_failed`; no mocked Trakt success substitutes for it.

Google Books has an implemented bounded adapter; its live search/detail path was not freshly verified in this gate.

The logged-in Trakt Developer/My Apps inspection showed no registered application and required GitHub connection before creating one; no app/key/connection was created. A paywall cause was not verified. Official [app registration](https://developer.trakt.tv/docs/create-an-app) and [API use policy](https://developer.trakt.tv/docs/api-use-policy) document GitHub verification and deletion of inactive registrations. The exact cause of this old credential's rejection remains unconfirmed.

Production SenseNet was inspected read-only: actual existing content and snapshots work, but optional `Year`/`SeriesName` are absent and Choice multiplicity differs from M0. Unsupported field/choice writes fail whole-plan preflight. Production gateway hosting, inventory coverage and actual visibility ACL transitions were not deployed/tested. Local visibility/privacy gates retain the original M0 security policy. The gateway requires all Timeline writers to share its persistent coordination boundary; raw repository administrators and multi-host/serverless writers are outside the verified guarantee.
