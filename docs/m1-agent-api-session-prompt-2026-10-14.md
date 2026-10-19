# Timeline Theories — M1 natív AI/agent tartalomkezelő API

Szia Cody! Folytassuk a Timeline Theories projektet a teljes M1 megvalósításával. A cél, hogy egy külső asszisztens — akár te — natívan, böngészőautomatizálás nélkül kapcsolódhasson az alkalmazáshoz, és az oldal API-ján keresztül ugyanazokat a tartalomkezelő műveleteket használhassa: olvasás/keresés, média létrehozás/frissítés/kezelés, timeline-ok és bejegyzéseik kezelése, tudatos sorrendmentés, metadatajavaslat és meglévő import/export. Vidd végig a szükséges közös domainréteggel, tényleges HTTP API-val, hitelesítéssel, valódi helyi SenseNet- és külső klienspróbával, UI integrációval, review-val, dokumentációval és developra célzott PR-ral. Ne állj meg tervnél, read-only végpontnál, OpenAPI fájlnál vagy adapter/mock tesztnél. Én tesztelek és merge-elek; ne merge-elj, ne kapcsolj automerge-et, ne deployolj.

## 1. Prioritás és termékirány

- A Trakt-import korábbi, már működő és használt feature. Minden fontosabb listámat áthoztam; további import-átépítés nem prioritás.
- Az előző M1 Trakt/lossless prompt visszavont javaslat. Az aktuális commission ez a dokumentum.
- 2026-10-14-en a kódot összevetettük a késznek jelentett funkciókkal és frissítettük a dokumentációt. Használd a tényleges állapotot, ne a régi Planned/Completed checkboxokat.
- Az API ugyanazt az alkalmazási képességet nyújtsa, amelyet az oldal, közös validációval/jogosultsági szabályokkal. Nyers általános SenseNet-admin proxy vagy a production SenseNet MCP önmagában nem teljesíti a célt.
- A külső agent kutathat, adatot javasolhat és jóváhagyott műveletet végezhet. Ehhez nem kell az appba saját LLM, kötelező MCP-regisztráció, új Supabase backend vagy új social-login rendszer.
- Minden lista a saját szerkesztői álláspontomat képviseli. Kiadási dátum, canon/continuity vagy AI-javaslat nem írhatja át automatikusan az elfogadott Position/Notes sorrendet.

## 2. Kiinduló checkout, git és dokumentáció

- Kanonikus checkout: D:/dev/gitjoe/timeline-theories. Itt dolgozz; ne készíts másik worktree-t. Windows, PowerShell, Europe/Budapest.
- GitHub: https://github.com/VargaJoe/timeline-theories . Kiinduló develop: f53774acbc586f382d999e339bdb1b00d7f1d951.
- M0 #47 user által merge-elve: e25b394697a392837968e4dbafa204986ea26567; M0 feature végső HEAD: 76b5000d9fbc339d0695d7141bf9ed572c0ab24c.
- Engedélyezett dependency maintenance: #33,34,35,36,38,39,41,43,44,45,46,48,51,52 merge-elve developba. #50 ReactRouter7.18.4 React>=18-at igényel, React17 mellett ERESOLVE/CI failed; ne merge-eld és ne használj --force/--legacy-peer-deps. Állapotukat frissen ellenőrizd.
- A 2026-10-14 dokumentációaudit helyi tracked módosításokat és új dokumentumokat hagyott a develop checkoutban. Először git status/diff; ezeket és a korábbi két handoff fájlt őrizd meg, ne reseteld/töröld őket. Review után a milestone explicit dokumentációs commitjába kerülhetnek; csak átnézett, explicit fájlokat stage-elj.
- Egy új feature/m1-native-agent-api branch, egy M1 PR developra. Ellenőrizd a fresh origin/developot és a user változásait; branch/sync ne vesszen el semmilyen helyi adat. M0 már merged, ne nyisd újra #47-et.
- Gyors előolvasás: docs/feature-status-audit-2026-10-14.md, docs/implementation-tasks.md, docs/api-documentation.md, README.md és docs/dependency-maintenance-2026-10-13.md.
- Célzott részletek: docs/operations-permissions-audit-2026-10-04.md, backend-storage-audit-2026-10-04.md, revival-audit-2026-10-04.md, export-import-guide.md. Ezek történeti auditok; a 2026-10-14 státusz és M0 kézzelfogható bizonyítéka az aktuális.
- docs/m1-session-prompt-2026-10-13.md superseded; import minőségi rések backlog, nem automatikus végrehajtási utasítás.

## 3. Kötelező projektmemória startup

Olvasd C:/Users/varga/Documents/Codex/CODY_OBSIDIAN_MCP_BOOTSTRAP.md. node_repl-lel a C:/Users/varga/.codex/config.toml konfigurált obsidian HTTP MCP endpointját használd; Mcp-Session-Id megőrzése, Authorization soha ne kerüljön outputba. HTTP hozzáférési hibánál a működő natív Obsidian MCP használható; ne olvasd/írd a helyi vault .md fájlokat.

Célzottan konzultáld: 00 Meta/Agent Memory Conventions.md, 40 Rules/Agent Diary Rules.md, Cody - Memory Map és 20 Projects/Software Development/Timeline Theories/Project Brief, Revival Plan, Feature Status Audit 2026-10-14, M1 Native Agent API, M0 Implementation Handoff, M0 Local Runtime and Profiles, M0 Operation Permissions, M0 Snapshot and Restore, Dependency Maintenance 2026-10-13. A régi M1 Trakt Import and Data Contract note superseded.

A session indulásakor ellenőrizd a Cody Diaryt és hozz létre Budapest-idős, már érdemi sessionbejegyzést, ha nincs. Naplózd a fontos döntéseket/failures/handoffot és kompresszió előtt a konkrét állapotot. Moduláris tartós memória, frontmatter/tag/wikilink/index backlink ellenőrzés lezárás előtt. Ne tölts újra már olvasott nagy anyagot.

## 4. Tényleges architektúra és forráspointerek

React17/TypeScript/Vite7.3.7 SPA Netlify-on; SenseNet tartalomtár, OIDC és alternatív SNAuth provider. Általános alkalmazási API, capability és OpenAPI még nincs. Traktproxy: client/netlify/functions/trakt-proxy.cjs, egy upstream list-items GET; server TRAKT_API_KEY. Express/pg npm dependency nem jelent kész alkalmazásszervert.

- client/services/timelineService.ts: create/list/delete/cover helper; detail/edit/IsVisible részben közvetlen guarded repository calls a client/pages/TimelineViewPage.tsx-ben.
- mediaLibraryService.ts: média/book CRUD, bináris/URL borítók; DOM/canvas resize, külön server adapter szükséges.
- timelineEntryService.ts: create/update/delete/list és reorder. Minden 100-as lapot olvas, stabil Position/Id sort, publisher-series esetén PublicationYear. Egy MediaItem több külön entryt szolgálhat ki.
- mediaUpdateService.ts és BulkUpdateDialog.tsx: provider preference/fallback, diff, missing-only/overwrite, approval/apply, retry/backoff; élő provider siker nem minden úton frissen igazolt. loadApiKey még létezik sensenet.ts-ben; repository-backed titkokat a jelenlegi böngészőservice olvassa.
- bookImportService.ts/BookImportDialog.tsx: OpenLibrary/GoogleBooks search/select/import és SeriesName metadata; nem teljes publisher feed sync.
- timelineExportService.ts#exportTimelineAsZip és timelineImportService.ts#prepareTimelineImport/importTimelineFromZip: a UI aktív 19-oszlopos TSV+cover ZIP útja. Meglévő local media-ID-t igényel; nem lossless cross-repo backup. Régi változatok timelineService.ts-ben is vannak.
- client/services/sensenet.ts, operationGuard.mjs és hooks/usePermissions.ts: konkrét cél/action kapuk, dispatch előtti recheck, identity/repo/revision context invalidálás.
- client/profile.mjs, configuration.ts, projectPaths.ts, contentTypes.ts: környezet, path és típuskontraktus.
- deployment/contenttypes/: Timeline, MediaItem, BookMediaItem (MediaItem leszármazott), TimelineEntry. Élő target schema és allowed values ellenőrizendő.
- Entries a timeline gyermekei; létező történeti sibling TimelineEntries fa megőrzendő. MediaLibrary subfolder is érvényes; Name nem feltétlen Id.

Részleges/hiányzó story nem válik API-paritás címén új M1 termékfeature-ré. Clone/fork, universe tags, multi-timeline rendering, rating/trending/discovery/reading-progress és social registration nincs teljesen megvalósítva.

## 5. M1 integrált scope

1. **Közös domainműveletek:** emeld ki a tartalomvalidációt, lookupot, műveleti terveket és jogosultsági feltételeket a browser-only kódból. A UI és API ténylegesen ugyanazokat a szabályokat használja; ne legyen két párhuzamos, eltérő CRUD implementáció. Browser auth/render és server transport/storage/provider adapters külön maradjanak.
2. **Valódi HTTP boundary:** stabil HTTPS JSON /api/v1, capability discovery és implementációval egyező OpenAPI, következetes hibakódok/eredményformátum, pagination és gépi használati példák. Válassz a tényleges Netlify/SenseNet korlátokhoz illő minimális server/hosting megoldást, dokumentáld és implementáld. Ne hagyd a működéshez nélkülözhetetlen gatewayt hipotetikus „később” elemként.
3. **Natív hozzáférés:** biztonságosan kiosztható/revokálható scoped credential, konkrét repository/auth/project/identity kötés. Egy alapcím és engedélyezett credential után külső process HTTP-ből tudjon csatlakozni. Thin CLI/MCP adapter opcionális; ne igényeljen vizuális browser-flowt minden tartalomművelethez. OIDC/delegation vagy más tokenmegoldást valódi SenseNet/jog bizonyítékkal válassz; nem elég a JWT payload dekódolása.
4. **Olvasás és tartalomfeltöltés:** timeline/media list/search/detail, occurrence list/detail; média/book create/edit/delete és borító; timeline create/edit/delete/visibility; entry add/edit/delete, reuse, notes/chronology/label/arc/importance; teljes sorrend explicit átállítása. Meglévő timeline-szabadkereső hiányát nem kell új UX-projektként megoldani, de API keresés legyen használható és jogosultságszűrt.
5. **Metadata és meglévő adatcsere:** külső agent által hozott forrásolt metadatajavaslat preview/apply, meglévő provider/book kereső/dúsítás és aktív import/export funkciók natív megfelelője. Szerveroldali titokhatár, forrás és bizonytalanság/field-diff; Joe kézi adata/sorrendje maradjon meg. Ne építs új teljes Trakt/lossless motort ennek ürügyén.
6. **Biztonságos változtatás:** preview számszerű diff/célok/előfeltételek és 0 tartalomtári írás; explicit apply; create/retry/duplicate elkülönítés; durable idempotency key+request hash, revision/conflict és partial-result/audit. Legitimate új előfordulást ne deduplikálj egy korábbi azonos MediaItem alapján. Delete hatása és shared references legyen látható/validált.
7. **Paritás:** írj műveletenként UI → shared domain → HTTP → jogosultság → valódi teszt táblázatot. Meglévő funkcionalitást ne hagyj csendben ki. Technikai akadálynál egyértelmű blocker vagy kifejezetten egyeztetett részfeladat; a capability ne hirdessen megvalósítatlan műveletet.
8. **Üzemeltethető handoff:** local indítási/credential/endpoint dokumentáció, Netlify/deployment config és szükséges env leírás secret nélkül; host/repo mismatch fail-closed. Az éles deployt és credential/prod-ACL beállítást Joe végzi.

Az első konkrét belső szelet legyen egy külső kliens által létrehozott timeline és két külön entry ugyanahhoz a médiához, közös UI/API domainútból. Ezt bővítsd a fenti teljes milestone-ra; nem indok egy read-only M1 és későbbi write-M3 újra szétválasztására.

## 6. Jogosultsági, adat- és env szerződés

- Normál dev/build targetje .env és hosting processenv szerint: VITE_SENSENET_REPO_URL, VITE_OIDC_AUTHORITY, VITE_OIDC_CLIENT_ID, VITE_AUTH_TYPE, VITE_PROJECT_ROOT_PATH. Ne írd át localhostra, fix cloudra vagy kötelező remote-readonlyra.
- Vite precedence .env/.env.local/.env.mode/.env.mode.local, process/Netlify felülír. Csak dev:m0/build:m0 választ explicit helyi JSON profilt. VITE_READ_ONLY optional, ugyanazon target írását tiltja. Public env allowlist nem secretterítés.
- Az app engedélyezett remote írást támogat; ez nem engedély az agentnek production tesztírásra. Agent implementációs adat/séma/ACL/írópróba kizárólag izolált helyi SenseNeten. Éles target read-only audit; éles credential/írás engedély külön.
- Nincs auto provisioning olvasás vagy hiba után. 404/401/403/TLS/transport/schema hiba nem „missing”, nem create és nem silent field drop.
- API scope, project boundary és valódi backend ACL mind szükséges. Open/read, parent AddNew+AllowedChildTypes, Save/update/upload, Delete. Minden batch cél preflight a legelső írás/providerfetch előtt, fresh recheck dispatchnál; unknown/failed jog deny.
- Visitor export/import kontroll rejtve; public media olvasható tényleges GET jog alapján. Anonymous HasPermission403 nem általános app-olvasástiltás.
- Nincs implicit owner credential fallback, admin-email jogkiterjesztés vagy általános raw repository passthrough. Scoped gateway nem kölcsönözhet korlátlan adminjogot.
- Provider kulcs szerveroldalon marad. Browser/client response/log/audit/OpenAPI ne tartalmazzon tokent/jelszót/private keyt/API keyt. Külső cover/provider originre ne küldj repository bearer-t.
- Szerveroldali kép/URL-fetch csak validált origin/protocol/input, méret/időkorlát és jogosultság alapján; ne nyiss arbitrary internal fetch capabilityt.
- Preview nem engedély foglalása: apply frissen ellenőrzi jogot/revíziót és targetet. Logout/revoke/identity/repo változás érvénytelenít.
- Valódi conditional write/transaction/CAS képességet tesztelj. Read-then-PATCH check, process-local lock vagy memória-cache nem párhuzamos UI/agent szerkesztés elleni garancia. Ha SenseNet nincs felkészítve rá, minimális helyi backendművelet vagy közös, valóban minden érintett íróút által használt mechanizmus szükséges; ne állíts atomikusságot bizonyíték nélkül.
- Restart után is idempotens retry; azonos key eltérő payload conflict. Partial failure nem teljes siker; pontos touched/not-applied/conflicted célok. Csak saját UUID fixture takarítható, user/source tartalom nem.

## 7. Helyi runtime és megőrzendő adat

M0 runtime legutóbb: HTTPS frontend localhost:8080 (explicit m0-local), repository localhost:41016, authority localhost:41017, timeline-m0 Docker projekt. PID-ek új sessionben frissen felderítendők; ne állíts le userfolyamatot találomra. Saját segédfolyamat Windows alatt hidden. Futtatható helyi indítás: deployment/scripts/m0-bootstrap.ps1 -TrustCertificate, npm run dev:m0. Nézd a README-t és a script inputját; meglévő volume-ra ne bootstrapelj destruktívan.

Ignored helyi snapshot: deployment/.local/snapshots/2026-10-13T14-32-10-703Z. Forrás 2998 rekord: Workspace1,Folder66,Timeline66,MediaItem1429,BookMediaItem8,TimelineEntry1428. 1503 binary mező (415 tartalom,1088 üres), 24470661 byte; ID-map/referencia/sorrend/binary SHA restore egyezett. 44public22private/Hidden timeline, 1068 kizárólag privát timeline-okhoz kapcsolt média local anonim Open denied. Ezek baseline számok, ne kezeld változhatatlan live állapotnak.

Őrizd meg deployment/.local, dbvolume*, certs, összes user .env variáció, snapshot/manifest/accounts, 18 legacy/env fájl és a ~631MB legacy adat. Ne stage-elj snapshotot, providerkulcsot, accountot, certet, tokent, dumpot vagy build outputot. Ne olvasd/printeld secretfájl tartalmát tool outputba. Ne git add .; explicit review-olt paths.

## 8. Kötelező tényleges elfogadási próba

Külön native HTTP process/CLI vagy agentadapter legyen a kliens, ne a browserwindowból hívott service vagy nyers SenseNet admin REST. Az alkalmazási API útját rögzítsd.

1. Capability/OpenAPI elérhető; discovery valós műveleteket/auth/limits jelez. Paginated read teljes és jogosultságszűrt; private/reference/binary adat nem szivárog.
2. Reader és writer scoped hozzáférés. Visitor/reader tiltott művelet nem jut repository write-ig; fake/expired/revoked/wrong-repo/wrong-project credential deny. Gateway nem emel valódi backendjogot.
3. Saját UUID timeline + média létrehozása; ugyanaz a média két distinct occurrence, saját notes/chronology. Native lookup/update/read-back és UI reload ugyanazt mutatja.
4. Metadatajavaslat, preview 0-write, apply a jóváhagyott field diffre; kézi mezők/sorrend védett. Bookmezők, external IDs és binary/URL cover natív út; UI láthatóság.
5. Complete-order preview és apply. Több cél egyikén deny → 0-write; per-dispatch revoke/identityváltozás megáll. Másik UI kliens közben módosít → explicit conflict, kézi módosítás megmarad. Nem újradátumozott, részleges vagy silent last-write-wins siker.
6. Identikus create/apply retry azonos keyvel (válaszvesztés és server restart után is) nem duplikál. Eltérő payload/lejárt plan konfliktus. Szándékos második occurrence más operationnal létrehozható.
7. Meglévő metadata/provider/book/import/export műveletek parity útja és tényleges alkalmazása helyben. ZIP ismert local-ID korlátja dokumentált; nem állítunk lossless portabilityt. Live provider credential hiánya explicit limit/blocker; fixture nem live bizonyíték.
8. Saját occurrence/media/timeline delete + shared reference ellenőrzés, fixture cleanup. Read-only env továbbra is ugyanazt a targetet olvassa és 0-write. Startup/read fault soha nem provision.
9. M0 releváns backend/permission/UI regression kapui sikeresek az új HEAD-en. Forrás count/reference/order/binary és legacy/env hash megőrzés kimutatva. Produktionhoz nem kapcsolsz írópróbát.

Alapellenőrzések: npm ci a rootban és clientben, npm test, npm run lint, npm run build, npm run build:m0 --prefix client, npm run build:readonly --prefix client. Érdemi local gates: npm run test:backend, npm run test:browser, npm run test:auth-storage; backend/ref/privacy regresszió a módosítás szerint. Meglevő scripts/m0-* és tests/*.test.mjs minták használhatók. Új API tesztek tényleges contract/auth/conflict/idempotency viselkedést vizsgáljanak, ne implementációt tükröző mockot.

Baseline 2026-10-13:51unit/lint/3build/33actualChromium/13backend/authstoragePASS; root audit17→10, client10 (0critical/3high/7moderate). Legacy SDK/OIDC/Quill/router major adósság ismert; ne alakítsd át M1-et dependency-migrációvá.

## 9. Lezárás

- Egy integrált, tesztelt M1 PR developra, aktuális scope-hoz írt cím/leírás, attach a taskhoz.
- Forrás/spec/parity/hosting/auth döntés és tényleges tesztbizonyíték, futatlan limitek/blokkerek külön. Valódi működést claimelj, ne csak szerver health/schema/exportot.
- Magyar handoff: branch/commit, build/test parancsok, natív csatlakozási és credential kiadási leírás, rövid copyable manuális smoke pontos UI label/eredmény szerint.
- Obsidian Project Brief/Revival Plan/M1 Native Agent API és sessiondiary frissítés, backlink/tag/frontmatter ellenőrzés.
- Ne merge-elj/ne deployolj/ne módosíts éles ACL/adat/sémát. Korábbi Dependabot merge engedély nem terjed az M1-re.
- M1 tényleges tartalomkezelési eredménye után javasolj következő, önmagában értéket adó mérföldkövet a tapasztalatok alapján.
