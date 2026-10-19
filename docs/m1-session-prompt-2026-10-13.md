# Timeline Theories M1 Trakt import és veszteségmentes adatcsere

> **SUPERSEDED — 2026-10-14.** Joe confirms Trakt import is an existing used feature and no longer the next priority. This historical proposal must not be executed as the current milestone. Use [M1 native agent API session prompt](m1-agent-api-session-prompt-2026-10-14.md); see [the source-backed feature audit](feature-status-audit-2026-10-14.md).

Szia Cody! Folytassuk a Timeline Theories projektet a teljes M1 megvalósításával. A cél egy megbízható, előnézetes Trakt import, amely teljes listákat olvas be, megőrzi a művek és az előfordulások azonosságát, újrapróbálható és megszakítás után folytatható. Készíts verziózott, veszteségmentes timeline export/import formátumot és működő sorrendnézeteket is. Vidd végig a szükséges kód-, séma-, valódi backend- és böngészős munkával, belső review-val, dokumentációval és egy developra célzott PR-ral. Ne állj meg tervnél vagy adapterek tesztjénél. Én tesztelem és merge-elem; ebben a sessionben ne merge-elj, ne kapcsolj automerge-et és ne deployolj.

## Ellenőrzött kiinduló állapot

- Kanonikus checkout: `D:/dev/gitjoe/timeline-theories`. Itt dolgozz, ne készíts másik worktree-t. GitHub: https://github.com/VargaJoe/timeline-theories . Windows, PowerShell, Europe/Budapest.
- M0: PR47 merge-elve a developba, merge commit `e25b394697a392837968e4dbafa204986ea26567`. Az M0 utolsó feature commitja `76b5000d9fbc339d0695d7141bf9ed572c0ab24c`.
- Joe a merge-et jelezte; production admin login és kézi production-élesítés ebből nem következik. Az M0 Netlify Visitor olvasási próbája sikeres volt, a production admin login/írás külön kézi ellenőrzés maradt.
- A dependency-karbantartás utáni develop: `f53774acbc586f382d999e339bdb1b00d7f1d951`. Ez rögzített átadási állapot, nem helyettesíti az induláskori friss fetch/PR-auditot.
- A 2026-10-13-i külön engedéllyel 14 Dependabot PR merge-elve: #33, #34, #35, #36, #38, #39, #41, #43, #44, #45, #46, #48, #51, #52. Az M0-ban már újabb kliensverziókat megtartottuk; nem történt downgrade. Root: DOMPurify3.4.17, qs6.16.0, proxy-addr2.0.8, path-to-regexp8.4.0, lodash4.18.1, body-parser2.3.0, react-router-dom6.30.6. Client: React17, React Router6.30.6, Vite7.3.7, DOMPurify3.4.17; @types/dompurify3.2.0 a csomag natív típusait használó stub.
- Az új #50 React Router7.18.4 PR nyitva maradt: React>=18-at kér, a jelenlegi React17 mellett npm ci ERESOLVE és Netlify/GitHub CI hibát okozott. Ez külön React/UI/SDK migrációs feladat. Ne oldd meg force/legacy-peer-deps kapcsolóval, ellenőrzések gyengítésével vagy az M1 csendes kibővítésével.
- Maradtak régi SenseNet/OIDC/Quill/router függőségi audit-találatok; a dependency-audit nem hibamentességi állítás. A rögzített számok és a végső összevont tesztek a `docs/dependency-maintenance-2026-10-13.md` átadásban vannak. Ne futtass npm audit fix --force-ot, ne downgrade-eld az SDK-t az audit javítási javaslata alapján.
- A helyi M0 runtime és adatok megmaradtak. A végén a frontend explicit m0-local módban futott. Induláskor ellenőrizd a saját processzeket/portokat, mielőtt bármit újraindítasz.
- Ez a prompt és a dependency-átadás új helyi Markdown fájl; ha még untracked, őrizd meg és majd az M1 saját review-olt commitjában add hozzá. A régi auditok és M0 dokumentumok megőrzendők. Ne használj git add ., reset --hard, force push, általános stash vagy branch-/volume-törlést.

## Indulási memória és munkarend

Olvasd az alkalmazandó AGENTS.md utasításokat és `C:/Users/varga/Documents/Codex/CODY_OBSIDIAN_MCP_BOOTSTRAP.md`-t. Obsidian csak a konfigurált HTTP MCP/REST kapcsolaton át: `C:/Users/varga/.codex/config.toml`, node_repl, Mcp-Session-Id megőrzése; Authorization/API key/jelszó/token értékét ne írd ki. A node_repl HTTP próbája ezen a hoston EACCES-t adott. A konfigurált natív Obsidian MCP már működik; a dokumentált shell-Node HTTPS MCP fallback is használható. Helyi vault .md fájlt ne olvass vagy szerkessz.

Induláskor célzottan konzultálj: `00 Meta/Agent Memory Conventions.md`, `40 Rules/Agent Diary Rules.md`, `10 Personas/Agents/Cody/Profile/Cody - Memory Map.md`, Cody Diary és Diary Index. Ha nincs megfelelő sessionnapló, hozz létre tartalmas Budapest-idős bejegyzést induláskor. A fontos döntéseknél, hibáknál, review-nál és handoffnál frissítsd. Az új tartós jegyzetek kapjanak frontmattert, tag-et, wikilinket és index/backlink utat.

Obsidian projektmappa: `20 Projects/Software Development/Timeline Theories/`. Document map és célzott fejezetolvasás után olvasd:

- `Project Brief.md`, `Revival Plan.md` M1 és rögzített termékalap;
- `M1 Trakt Import and Data Contract.md` és `Dependency Maintenance 2026-10-13.md`;
- `M0 Implementation Handoff.md`, `M0 Local Runtime and Profiles.md`, `M0 Operation Permissions.md`, `M0 Snapshot and Restore.md`;
- szükség szerint a régi `Revival Audit 2026-10-04.md`, `Backend Storage Audit 2026-10-04.md`, `Operations and Permissions Audit 2026-10-04.md` célzott megállapításait.

A git állapotot, friss origin/developot és nyitott PR-eket ellenőrizd. A kész baseline után egy új `feature/m1-trakt-import-data-contract` ág, egy milestone és egy PR legyen. Az M0/Dependabot ágakat ne folytasd M1 fejlesztésre. A dependency-merge engedély a korábbi karbantartásra szólt; az M1 merge/deploy nálam marad.

Tartsd röviden az agent-loopot: újrafelolvasás helyett használd a már összegyűjtött bizonyítékot, a konkrét diffet és a célzott kereséseket. Batching független read-only ellenőrzésekhez. Hosszú, jól elválasztható megvalósítási fázisra használhatsz szűk feladatcsomagos belső agentet; ne duplikált bootstrap vagy szimulált új session legyen. A szülő review-ja és integrációs ellenőrzése kötelező.

## Termékszerződés

A létező, személyes kronológiaeszközt fejlesztjük: https://timelines.vargajoe.hu/ . A történeten belüli időrend az elsődleges érték, de megjelenési vagy más olvasási sorrend is lehet. A publikált listák az én elfogadott szerkesztői sorrendemet és leírásomat tartalmazzák. A canon/stúdió álláspontja forrás lehet, az alkalmazás nem döntőbíró. Ne írj át leírást, megjegyzést vagy sorrendet forrásból találgatva.

A domain külön kezeli a közös `MediaItem`/`BookMediaItem` művet, a listabeli `TimelineEntry` előfordulást és a `Timeline` listát. Ugyanaz a mű több listában, ugyanabban a listában többször is szerepelhet. Cím/év/megnevezés alapján nincs automatikus deduplikálás vagy összevonás. A személyes manuális módosítást nem szabad reimporttal felülírni.

## Környezeti és jogosultsági határok

**A normál npm run dev/build célt az én .env/hosting beállításom választja. Ezt ne írd felül localhosttal, kötelező read-only profillal vagy hardcoded cloud céllal.** Standard Vite prioritás: .env, .env.local, .env.<mode>, .env.<mode>.local, végül process/Netlify változók. Repo/auth: VITE_SENSENET_REPO_URL, VITE_OIDC_AUTHORITY; publikus client ID és project root is envből. Auto auth discovery csak provider-típust választ, authorityt/client ID-t nem cserél. A publikus allowlistből arbitrary VITE_* secret/API key/token nem kerülhet bundle-be. A diagnosztikai sáv csak DEV-ben látszik.

Csak az explicit `npm run dev:m0` / `npm run build:m0 --prefix client` választja az izolált local tesztprofilt. `VITE_READ_ONLY=true`/readonly parancs explicit appírás-tiltás, a target változatlan. A konfigurált remote repón az alkalmazás jogosult felhasználója műveleti kapuk után írhat; ez **nem engedély az agent productionírására**.

- Agent SenseNet-tesztírás kizárólag az elkülönített M0 repón. Production `https://plastice.sensenet.cloud` és auth `https://plastice-is.sensenet.cloud` legfeljebb célzott olvasási diagnosztika a konfigurált sensenet-plastice MCP-n. Nincs production content/schema/ACL írás, production restore, merge/automerge/manual deploy.
- Ha az M1 új mezőt/actiont/backend-szerződést igényel, alkalmazáskor előbb a tényleges env szerinti cél capability/schema megfelelését vizsgáld. Hiány esetén az adott import/apply adjon érthető előfeltételhibát0írással; nincs csendes mezőeldobás, production auto-provisioning vagy a teljes app targetjének átállítása.
- Élő Trakt API-ból a feladatnak megfelelő public lista olvasása engedett. A provider credential kizárólag szerver/private env és engedélyezett provider-origin felé mehet, nem browser bundle-be, query stringbe, artifactba vagy logba. A meglévő saját env fájljaimat ne írd felül. Ha a live olvasáshoz hiányzik credential, jogosultság vagy megfelelő lista, kérdezz korán és folytasd az ettől független fixture/codec munkát; a fixture sikert ne nevezd live bizonyítéknak.
- Startup, lookup és 404/401/403/TLS/network/server hiba nem provisioning és nem create-utasítás. A preview minden írókérés nélkül működik.
- Route/UI, handler, service és transport kapuk maradnak: exact target Open; parent AddNew és AllowedChildTypes; target Save/Delete; cover Save. Login/csoportnév/email/ACT nem helyettesít konkrét műveleti jogot. Unknown/error zárt marad; logout/identity/repo/revision változás megszakítja a függő tervet.
- Visitor Export/Trakt gomb rejtett; Reader nem ír. Anonim HasPermission az olvasható public tartalomra is403-at ad, ezért az app exact-target GET-tel vizsgál olvasási elérhetőséget; bejelentkezve HasPermission marad. A local DomainReadPolicy backendben is Open-t kényszerít.
- Média URL Name-alapú, alkönyvtáras Name→Id-only lookup után külön ID guard/load/poll; slugváltás remount. Ne állítsd vissza a hibás flat mediaLibraryPath/name guardot, ne értelmezd a numerikus Name-et automatikusan ContentId-ként. A cache-jogvisszavonás és logout utáni adatok eltűnése maradjon.

## Helyi baseline és gyors indítás

Repository HTTPS localhost41016, IdentityServer localhost41017, frontend localhost8080; csak loopbacken kötött, trusted Windows CurrentUser cert. Docker Compose projekt timeline-m0, külön SQL/auth/repo volume-ok, digest-pinned image-ek. Legacy dbvolume, env és cert megőrzött; nincs down -v vagy általános törlés. M0Reader/M0Editor dedikált helyi LoginName, jelszó/API key csak ignored `deployment/.local/accounts.json`. Az emailnek látszó loginmezőbe a LoginName kell.

```powershell
cd D:\dev\gitjoe\timeline-theories
git -c safe.directory=D:/dev/gitjoe/timeline-theories status --short
git -c safe.directory=D:/dev/gitjoe/timeline-theories fetch origin
npm ci --prefix client
./deployment/scripts/m0-preservation.ps1
# Csak ha setup/restart szükséges; a működő runtime-ot ne állítsd vissza vakon:
./deployment/scripts/m0-bootstrap.ps1 -TrustCertificate
npm run dev:m0
```

A működő Vite folyamatot hagyd meg, vagy kizárólag az azonosított saját workspace/m0-local példányt indítsd újra. A root npm install --prefix client csomagnév nélkül ebben a sessionben file:.. önfüggőséget tett a clientbe; ilyet ne tarts meg. Dependency módosításhoz a megfelelő workdirben dolgozz, ellenőrizd a package/lock diffet; frozen npm ci --prefix client sikeres volt. A csomagfrissítés nem lehet véletlen lockfile-regenerálás vagy SDK-downgrade.

Forrás snapshot: ignored `deployment/.local/snapshots/2026-10-13T14-32-10-703Z`. 2998 rekord: Workspace1, Folder66, Timeline66, MediaItem1429, BookMediaItem8, TimelineEntry1428. 1503 binary mező, 415 nemüres/1088 üres, 24470661 byte. Restore mező/ref/order/binary SHA256 eltérés0; saját runtime stop/start után ugyanez, ID-map változatlan. 44public/22private-Hidden timeline;1068 kizárólag privát médiának local Open-deny. A megosztott public média olvasható marad. A source adatot ne szerkeszd a smoke során, saját UUID-fixture-ekkel dolgozz.

Az M0 C# handler egy repositoryprocessre és provisionált local role-okra készült. Timeline default-private visibility ACL, exact Open/OpenMinor domain és reference projection, raw referenciaindex és kontrollált deletion lifecycle. Az explicit null/empty MediaItem kapcsolatváltoztatás tiltott; teljes entryDelete külön művelet. Ha új importmetadata mező/séma kell, a local típusokat, DTO-kat, serializer/schema coverage-et és handler-kompatibilitást együtt vezesd végig. Ne lazíts biztonsági kaput az import kedvéért, ne írj a database/field table-be közvetlenül.

## A friss kódvizsgálattal megerősített M1 rések

- `client/services/traktService.ts`: DEV-ben csendesen betölti az example-trakt-response.json-t; ez a mode nem a felhasználó explicit fixture/live döntése. A mapTraktItem eldobja a listabeli id/rank/notes/listed_at mezőket. Season/episode esetén a show.ids kerül az entity ids helyére.
- `client/netlify/functions/trakt-proxy.cjs`: server-private TRAKT_API_KEY, egyetlen list/items GET; nincs teljes pagination loop vagy továbbadott lapozási állapot. A local Vite számára működő live provider út nincs igazolva. A korábban törölt sensenet.js credential-loader ne kerüljön vissza.
- `client/components/TraktImportDialog.tsx`: fetch után minden sorhoz új MediaItem és új TimelineEntry, position=index+1; notes/source-rank/source-occurrence elvész. Nincs diff preview, persistent idempotencia/journal vagy megszakítás utáni biztonságos resume.
- `client/services/timelineImportService.ts`: M0 exact-operation ZIP preflight van, de 19-oszlopos TSV, meglévő local media ID kell. Nem hordozható, teljes domainadatcsomag.
- `client/services/timelineExportService.ts`: legacy 19 oszlop és borítók; több média/entry/timeline mező hiányzik. Ez nem veszteségmentes roundtrip és nem helyettesíti a külön M0 snapshotot.
- `client/services/timelineEntryService.ts`, `client/pages/TimelineViewPage.tsx`: Position, publication-date/PublicationYear és chronological-date ágak, illetve SortOrder; a film/sorozat kiadási sorrend és az elfogadott kézi sorrend végigvezetése auditálandó, javítandó.

A részletes régi forráspointerek: `D:/dev/gitjoe/timeline-theories/docs/revival-audit-2026-10-04.md` Trakt import, ZIP export/import és Javasolt mérföldkövek fejezetek. A régi stories/implementation-tasks kész jelölései nem elfogadási bizonyítékok.

## M1 integrált megvalósítási határ

### 1 Egyetlen Trakt beolvasási és normalizálási út

Fixture és live legyen explicit, ellenőrizhető választás, a repo/auth választásától függetlenül. Nincs DEV-alapú csendes adatcsere és nincs live hiba után fixture fallback. A local fejlesztés és Netlify ugyanazt a provider/pagination/normalizációs logikát használja; ne maradjon két eltérő mapping.

Az aktuális hivatalos Trakt API dokumentáció alapján kezeld az összes lapot és a pagination/total/meta információt. Több mint250 elem teljesen érkezzen meg. Truncation, ismételt/hiányzó lap, hibás total, rate-limit és timeout nem jelenthet sikeres teljes importot. Kezeld a 429/Retry-After-t és legyen megszakítás, korlátozott újrapróba; provider hiba alatt ne induljon repoírás. Ha a forrás beolvasás közben változik, jelezd és friss előnézet kelljen.

Normalizált adatban külön marad: provider/lista, listabeli occurrence ID ha van, rank, notes, listed_at és a movie/show/season/episode saját entityazonosítói; show parent ID/season/episode számozás is megőrzendő. Episode nem a show azonosítójával azonosítandó. A hiányos/ellentmondó azonosság legyen előnézeti konfliktus, ne cím alapján találgatás. Hiányzó év/dátumot ne tölts ki Jan1/0/mai dátummal; a forrásból ténylegesen ismert érték maradjon.

### 2 Valós előnézet és egyeztetés

Előnézetben jelenjen meg minden tervezett új mű, mű-újrafelhasználás, új/megmaradó/módosuló előfordulás, sorrend- és jegyzetváltozás, konfliktus, hiányzó forráselem és íráscél. A backendben még semmi nem változhat. A megosztott média módosításának más listákra gyakorolt hatása külön döntés, nem az entry jogából következő automatikus Save.

Az elfogadott kézi sorrend és a kézzel módosított notes/domain mezők alapértelmezésben megmaradnak. Forrásrang új lista első beolvasásakor sorrendi információ; reimportnál nem írja felül vakon a Positiont. A forrás/saját/jelenlegi állapot eltéréseit explicit egyeztesd. Forrásból eltűnt előfordulást ne törölj automatikusan.

### 3 Idempotens és folytatható apply

Bizonyítsd stabil source és occurrence kulcsokkal, hogy ismételt azonos import vagy ugyanazon sikertelen job folytatása nem hoz létre újabb művet/előfordulást. Szándékos többszöri előfordulás külön marad. Hiányzó/stabilitását nem igazolt provider item ID esetén dokumentált, ütközésbiztos egyeztetés kell; a rank, cím vagy futáskor generált UUID önmagában nem retry-azonosság.

A job/állapot megőrzése legyen repo- és identitásszkópos, reload/újraindítás után ellenőrizhető; ne csak sikeres processzen belüli cache-rel teszteld. Legyen terv- és verzió/fingerprint ellenőrzés, eredmény/journal és pontos failed/resume állapot. Közben kézzel módosított entryt ne írjon felül elavult terv. Nézd meg az actual SenseNet concurrency lehetőségeit; egyszerű read-then-write vagy UI-lock nem bizonyít atomikus konfliktusvédelmet.

Az összes ismert cél/operation legyen ellenőrizve az első írás előtt, majd minden dispatch frissen. Preview objektum mutációja nem távolíthat el privát apply-ellenőrzést. Identity/logout/repo/jogváltozás után a terv érvénytelen. Egy több lépéses backend hiba nem tranzakció: részleges eredményt pontosan jelezz, és úgy folytass, hogy ne maradjon néma duplikáció, árva vagy elveszett előfordulás. A hibát ne tüntesd el sikeres importként.

### 4 Verziózott veszteségmentes timeline csomag

Legyen dokumentált formátumverzió, manifest és schema/mezőtérkép, külön timeline/media/occurrence azonosság és referenciák, csomagon belüli logikai ID-k és cross-repository ID-remap. Timeline név/leírás/visibility/sorrendbeállítás, valamennyi támogatott média- és book mező, entrymező/jegyzet/pozíció, Choice/Reference/null/hiány/false/0, Unicode/tab/újsor/időpont, ExternalLinks és meglévő binary borító megőrzendő. A rendszer által generált local ID/audit/version nem byte-azonos restore-cél: az eredeti provenance és a regenerált helyi metaadat külön kezelendő, az összehasonlítás szerződése egyértelmű legyen.

Egy csomagban a közös mű egyetlen logikai mű, a két rámutató előfordulás két rekord. Másik üres, local tesztcélra importálva új backend ID-k mellett azonos domainadat/sorrend/ref és binary SHA256 kell. Teljes saját inputcsomag ismeretlen verziója/mezője, törött referenciája/hash-e, zip path traversal/értelmezhetetlen payloadja az első írás előtt hibázzon; ne legyen silent drop. Secret/auth/API-key/security-admin adat nem domain export.

Privát timeline/csomag importja nem publikálhatja véletlenül az új privát domainadatot vagy borítót. A cél backend tényleges ACL/privacy policyja érvényesüljön; más listákban már public megosztott média jogát ne változtasd egy privát hivatkozás miatt. ACL-kezelés csak konkrétan ellenőrzött backendművelettel és a local tesztkeretben, nem általános emelt jogosultságú kliensúttal.

Az olvashatatlan hivatkozott mű/binary nem lehet néma, hiányos lossless siker. A külső CoverImageUrl megőrzése nem igényli, hogy külső URL tartalmát binárissá alakítsd. A legacy ZIP/TSV beolvasás legyen explicit kompatibilis vagy világosan migrálható, meglévő local ID-határral; ne nevezd a régi 19-oszlopos roundtripet veszteségmentesnek. Az M0 teljes projekt-snapshot/restore külön fejlesztői eszköz marad.

### 5 Működő sorrendnézetek

Az alapnézet az elfogadott Position/szerkesztői sorrendet tartja meg. Megjelenési és kronológiai alternatíva a megfelelő ismert domain dátumot/évmezőt használja, stabil tie-breakkel; filmnél nem Book.PublicationYear-t feltételez. Hiányzó dátum rendezése dokumentált, nincs dátumtalálgatás. Nézetváltás Visitor/Reader esetén0írás, az eltárolt Position nem módosul. Manuális drag/reorder csak a tényleges canonical edit-nézetben és minden érintett entry Save joga mellett történhet.

## Kötelező elfogadás és bizonyíték

Használj verziózott synthetic fixture-t legalább501 elemmel, több lappal, movie/show/season/episode saját és parent ID-val, azonos show két eltérő epizódjával, szándékosan kétszer szereplő művel, rank/notes/null/Unicode és hiányzó év/dátum eseteivel. Élő Trakt public lista olvasását külön bizonyítsd actual server provider útvonalon, local és a Netlify handler működési módját elkülönítve; >250 teljes lista a pagination gate. Mock/fetch fault injection az errorvédelem tesztje, nem a live provider vagy a valódi SenseNet/böngésző bizonyítéka.

1. Teljes pagination: minden occurrence és rank/notes/entityID egyezik; truncation/ismételt lap/429/timeout nem indít írást.
2. Preview fetch→diff→választás közben0repo-mutation; már ismert bármely target-deny esetén apply is0write. Visitor/Reader direct handler/service/route megkerülésével sem írhat.
3. Első import actual local SenseNettel: várt media/occurrence darabszámok, külön epizódazonosság és külön ismételt occurrence, nincs árva referencia/dupla importkulcs.
4. Azonos import újra, valódi részleges backend hiba, abort, reload, folyamat/runtime restart és resume után a végső adat egyezik, nincs extra mű/előfordulás. A forrásrank és egy kézzel módosított Position/Notes konfliktusa előnézetet kér, nem veszteséget okoz.
5. Preview után exact-target jogvisszavonás, logout/identity/repo váltás és közben végzett kézi edit zárja az elavult applyt. Shared media Save és entry Save/upload külön kapu marad.
6. Lossless export→új local cél import→új export: teljes domainösszehasonlítás és binary SHA256 egyezés; más backend ID-k szabályos remapje, egy shared média/több occurrence. Opcionális mező hiánya, explicitnull, Rating0 és Choice tömb nem veszik el.
7. Unknown format/schema/hash/ref/zip hiba előtt0write; unsupported legacy forma érthető migrációs hibát ad. Hiányzó vagy nem olvasható target nem create-kérés.
8. Manual/release/chronological UI nézetek film+sorozat+book és ismeretlen dátum mellett helyesek, stabilak; nézetváltás0write és Positions változatlanok. Saját timeline leírás és szerkesztői sorrend reimport/export után is egyezik.
9. Actual Chromium user flow: Login→forrásmód→teljes lista→preview→egyeztetés→apply→resume→timeline→export/import→logout, Visitor és Reader deny mellett. UI címkés, másolható kézi checklist is kell, branch/commit megjelöléssel.
10. Fixture cleanup csak saját explicit UUID/ID-kre, source-ID kizárással; mind2998source rekord megmarad, legacy/env hash változatlan. Ha egy schema/API változás a M0 védelmét érinti, actual backend/reference/privacy regresszió is kötelező.

Indulási/final baseline parancsok külön terminálban a local Vite mellett:

```powershell
npm test
npm run lint
npm run build:m0 --prefix client
npm run build:readonly --prefix client
# Normál build a saját env/process beállítás szerinti célt használja:
npm run build
npm run test:backend
npm run test:browser
npm run test:auth-storage
./deployment/scripts/m0-preservation.ps1
```

M0 korábbi actual referenciabizonyíték: `npm run test:reference`74/74, `npm run test:privacy`46/46 és2580minta,0privát200/0redactedfallback. A C# backend/séma érintésénél futtasd őket. Az új M1 tesztparancsokat dokumentáld és integráld a CI-be; ne helyettesítsd a valódi provider/backend/böngésző utat mockokkal.

## Ellenőrizendő forráspointerek

Minden relatív út a kanonikus `D:/dev/gitjoe/timeline-theories` alatt értendő:

- Provider és UI: `client/services/traktService.ts`, `client/netlify/functions/trakt-proxy.cjs`, `client/components/TraktImportDialog.tsx`.
- Domain és adatcsere: `client/services/timelineEntryService.ts`, `mediaLibraryService.ts`, `timelineService.ts`, `timelineExportService.ts`, `timelineImportService.ts`, `client/pages/TimelineViewPage.tsx`, `client/contentTypes.ts`, `client/services/contentValues.ts`.
- Környezet/jogok: `client/profile.mjs`, `client/vite.config.ts`, `client/configuration.ts`, `client/App.tsx`, `client/AppProviders.tsx`, `client/services/sensenet.ts`, `operationGuard.mjs`, `client/hooks/usePermissions.ts`, `client/components/PermissionContent.tsx`, `LazyImage.tsx`, `client/context/snAuthStorage.mjs`.
- Séma/backend: `deployment/contenttypes/*.xml`, `deployment/extensions/m0-timeline-security/*.cs`, `deployment/docker-compose.yml`, `deployment/scripts/m0-bootstrap.ps1`, `m0-build-security.ps1`, `m0-runtime.ps1`.
- Adat és regresszió: `scripts/m0-snapshot.cjs`, `m0-restore.cjs`, `m0-acl.cjs`, `m0-persistence.cjs`, `m0-local-api.cjs`, `m0-browser-smoke.cjs`, `m0-reference-privacy-smoke.cjs`, `m0-timeline-privacy-smoke.cjs`, `m0-oidc-smoke.cjs`, `m0-sn-auth-storage-smoke.cjs`, `tests/operation-guard.test.mjs`, `tests/environment-profile.test.mjs`, `.github/workflows/m0-checks.yml`.
- Korábbi átadás: `docs/m0-client-safety.md`, `docs/m0-local-data.md`, `docs/m0-verification-2026-10-13.md`, a három2026-10-04audit és az új dependency-karbantartás jelentése. Ignored runtime/report/snapshot segítség bizonyíték, nem commitolandó forrás.

## Befejezés és halasztások

A teljes M1 marad egy review-olható PR: rewrite title/body a tényleges eredményre, fejldomain és security diff belső review, minden szükséges teszt a végső HEAD-en, privacy/secret fájltartalom-ellenőrzés és explicit staging. Snapshotot, credentialt, certet, PII-t, provider teljes privát válaszát, binary/reportot ne commitolj. Ne nyiss új milestone PR-t a részekre önálló jóváhagyás nélkül. Add át a branch/commit/PR linket, actual provider/backend/browser bizonyítékot, pontos kézi smoke-ot, adatok/processzek állapotát és érdemi korlátokat. Obsidian tartós döntés, kódpointer, tesztparancs és napló legyen friss és linkelt.

M1-ben nincs általános UI-redesign, új médiafelfedező/trending/rating/olvasáskövetés, canon/universe kötelezőadmin, cross-reference/párhuzamos nézet, production SenseNet ACL/login migráció, React/MaterialUI/OIDC SDK főverziómigráció vagy agent API. M2 később a meglévő UI és olvasó HTTP/capability/OpenAPI; M3 ellenőrzött agentírás preview/apply/scope/idempotencia/conflict szerződéssel. Most a teljes, bizonyított import és adatmegőrzés elkészítése a feladat.
