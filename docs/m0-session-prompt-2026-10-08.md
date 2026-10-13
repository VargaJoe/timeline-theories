# Timeline Theories – M0 megvalósítás

Szia Cody! Folytassuk a Timelines projektem felélesztését. Ebben a sessionben valósítsd meg a teljes M0-t: biztonságos helyi fejlesztés, megbízható környezetválasztás, az automatikus írások megszüntetése, a meglévő adatok helyi átvétele és a műveletekhez kötött jogosultságkezelés. Vidd végig a szükséges ellenőrzésekkel, dokumentációval, belső review-val és developra célzott, átnézhető PR-ral. Én tesztelem és merge-elem; ne merge-elj, ne kapcsolj automerge-et, és ne deployolj.

## Kiinduló állapot és memória

- Kanonikus checkout: `D:\dev\gitjoe\timeline-theories`. Itt dolgozz, ne készíts másik worktree-t. GitHub: `https://github.com/VargaJoe/timeline-theories`.
- A 2026-10-08-i ellenőrzéskor: `develop`, HEAD `04990d3b8f9f3dec667dde40141e90f5f9b0c0d5`. Három nem követett, megőrzendő auditdokumentum van; alkalmazáskód-javítás és M0 PR még nincs. Ellenőrizd újra a git/PR állapotot, ne írj felül más munkát.
- Olvasd a checkout `AGENTS.md` utasításait és a `C:/Users/varga/Documents/Codex/CODY_OBSIDIAN_MCP_BOOTSTRAP.md` fájlt. Az Obsidian-memóriát a `C:/Users/varga/.codex/config.toml` konfigurált HTTP MCP-jén érd el, node_repl használatával, a `Mcp-Session-Id` megőrzésével. Authorization/API key értékét ne írd ki. Ha node_repl fájlhozzáférése hibás, dokumentált fallbackként shellből futtatott Node használható ugyanahhoz a konfigurált HTTP MCP-hez; a helyi vaultfájlokat ne olvasd vagy szerkeszd.
- Induláskor nézd meg: `00 Meta/Agent Memory Conventions.md`, `40 Rules/Agent Diary Rules.md`, Cody memória térképe, a `10 Personas/Agents/Cody/Diary/` aktuális naplója. Ha nincs megfelelő sessionnapló, hozz létre tartalmas, budapesti idő szerinti bejegyzést rögtön induláskor; később a fontos döntéseknél és a handoffnál frissítsd.
- Obsidian projektmappa: `20 Projects/Software Development/Timeline Theories/`. Célzottan olvasd: `Project Brief.md`, `Revival Plan.md`, `Revival Audit 2026-10-04.md`, `Backend Storage Audit 2026-10-04.md`, `Operations and Permissions Audit 2026-10-04.md`, `M0 Session Handoff 2026-10-08.md`. A régi audit-only határt ebben a promptban kifejezetten felváltja az M0 megvalósítására adott feladat; az éles rendszer írási tilalma megmarad.
- A részletes bizonyítékok a megőrzendő fájlokban vannak:
  - `D:\dev\gitjoe\timeline-theories\docs\revival-audit-2026-10-04.md`
  - `D:\dev\gitjoe\timeline-theories\docs\backend-storage-audit-2026-10-04.md`
  - `D:\dev\gitjoe\timeline-theories\docs\operations-permissions-audit-2026-10-04.md`

## A termék rögzített alapjai

A létező oldal `https://timelines.vargajoe.hu/`, számos Traktról importált listával. Ezeket élesztjük fel; nem nulláról indulunk. A fő cél a történeteken belüli időrend, de megjelenési vagy más rendezési elv is lehet. Filmek, sorozatok, könyvek, játékok és más kapcsolódó történetformátumok is részei lehetnek.

Minden közzétett időrend az én elfogadott szerkesztői sorrendem. A canon, stúdió vagy alkotók álláspontja lehet forrás, de az alkalmazás nem döntőbíró; az ellentmondásokat a lista leírásában fejtem ki. Jelölési támogatás később opcionálisan jöhet, kötelező pluszadminisztráció nélkül.

A tárolás alapja már most: `MediaItem → TimelineEntry → Timeline`. A közös mű és a listabeli előfordulása külön entitás; ugyanaz a mű több listában, akár ugyanabban a listában többször is szándékosan szerepelhet. A meglévő sorrendet, megjegyzéseket és előfordulásokat őrizd meg. Ne végezz cím alapján automatikus összevonást, deduplikálást vagy újrarendezést.

## Éles rendszer: kizárólag olvasás

A production SenseNet-belépés jelenleg hibás; ezt külön javítjuk. A szolgáltatói ok nincs igazolva. Az M0-ban a helyi belépés működését kell biztosítani.

A konfigurált `sensenet-plastice` MCP a production `https://plastice.sensenet.cloud/` repositoryhoz csatlakozik. Használhatod célzott olvasási auditra és projektadatok/sémák/binárisok mentésére. Ne hozz létre, módosíts, törölj, tölts fel, mozgass tartalmat, és ne változtass ACL-t productionben. A „restricted” mód nem bizonyít read-only jogosultságot: engedélyezett olvasó műveletekből dolgozz. A fejlesztési és tesztírások kizárólag az elkülönített helyi repositoryra menjenek.

Helyi SenseNet MCP a legutóbbi ellenőrzéskor még nem volt konfigurálva; később beállítom. Ez ne legyen előfeltétel, ha a helyi REST/SDK kapcsolaton a valódi működés ellenőrizhető. Ne nyisd meg tesztként az éles frontendot: a jelenlegi telepített kód olvasáskor is automatikus írást próbálhat. A production API olvasása legyen kontrollált.

## Ellenőrzött hibák és M0-feladatok

1. **Helyi runtime és környezetválasztás.** A deployment alatt már van Docker Compose, contenttype XML és tanúsítványkezelés. Előbb mérd fel a tényleges helyi állapotot; a korábbi Docker-hozzáférési hiba nem bizonyítja, hogy a daemon áll. Őrizd meg a meglévő konténereket, volume-okat, `deployment/dbvolume` adatokat, tanúsítványokat és gitignorált konfigurációkat. Ne használj adatvesztő újraindítást vagy `down -v`-t. Az aktuális Compose 41016/41017 HTTPS portokat használ; egyes régi env-változatok 51016/51017-et. Készíts reprodukálható helyi indulást, működő repositoryt/authot, tartós tárolást és valódi böngészős használathoz megfelelő helyi HTTPS-t.

   A korábbi env-hiba oka igazolt: a `.env.local` felülírja a kézzel `.env`-be másolt production repositorycímet, miközben más cloud auth-beállítás megmaradhat. Vite sorrend: `.env`, `.env.local`, `.env.[mode]`, `.env.[mode].local`; a process env elsőbbséget élvez. A `.env.prod` nem a normál `production` mód profilja; a `.env.itteni` és `.env.miez` sem automatikus standard profil. Legyen egyértelmű, dokumentált, explicit profilválasztás és helyi alapértelmezés, titokmentes példafájlokkal. Látszódjon a tényleges repo/auth cél és mód; eltérő környezetek összekeverése ne maradjon rejtve. A dev útvonalon a production írás legyen technikailag tiltott, ne csak dokumentált. Az env-változtatás után szükséges újraindítást is írd le.

2. **Automatikus létrehozás és hibakezelés.** A `client/scripts/setupMediaLibrary.ts` importáláskor is fut, és a `client/App.tsx` ismét meghívja, még auth-készenlét előtt. A MediaLibrary olvasásának bármely hibájára Folder létrehozást próbál. Ezt teljesen távolítsd el az alkalmazás indulási/olvasási útvonalából. Provisioning csak kifejezett helyi setup-művelet legyen, ellenőrzött célon, jogosultsággal és sémával. Egy 404 önmagában sem létrehozási utasítás; 401/403/hálózati/TLS/szerverhiba végképp nem „hiányzó elem”. A legacy `timelineService.ts` hasonló lookup-error→create ágát is vizsgáld át.

   A production Folder-log nem szándékos új elem mentése volt: a hibás fallback próbálta. A MediaLibrary már létezik. Visitornek nincs létrehozási joga; egy aktuális AllowedChildTypes lista sem igazolja ezt a műveletet.

3. **Meglévő adatok teljes helyi átvétele.** Készíts ellenőrizhető, lapozott, időbélyeges, megismételhető projekt-snapshotot és kontrollált helyi restore-t, sémákkal, médiaelemekkel, timeline-okkal, előfordulásokkal és szükséges binárisokkal. Az aktuális ZIP export/import veszteséges, ezért nem tekinthető teljes mentésnek. A snapshotok és privát adatok maradjanak gitignorált helyen; production credentialt, API key-t, tokent és felesleges production identitást ne exportálj vagy másolj a helyi authba. Helyi tesztidentitásokat használj.

   Külön kezeld az új repositorybeli azonosítókat és referenciákat: legyen explicit régi→új ID-térkép, ne feltételezd az ID-k megtartását. Ellenőrizd a darabszámokat, típusokat, mezőértékeket, sorrendet, ismételt előfordulásokat, leírásokat/megjegyzéseket és binárisok integritását. Készíts árva referencia/duplikáció/adateltérés riportot; ne „javítsd” automatikusan a tartalmi döntéseket. A rejtett/privát elemek kezelését és az alkalmazott szűrőket dokumentáld. A helyi újraindítás után is maradjon használható az adatállomány.

4. **Konkrét célhoz és művelethez tartozó jogosultság.** Alapszabályom: „amihez nincs joga, azt meg se próbálja”. A bejelentkezés, email/adminlista, csoportnév, `isAdmin` vagy AllowedChildTypes nem helyettesíti a tényleges jogosultságot. Vizsgáld és javítsd együtt a UI-t, közvetlen route-okat, handlereket és a közös szolgáltatásréteget. Tilalom vagy ismeretlen jogosultság esetén ne küldj írást; a backend ACL továbbra is döntő és védje a kliens megkerülését is.

   Érintett: timeline és entry CRUD, media CRUD, import/bulk/reorder, borítófeltöltés és privát timeline-olvasás. Entry szerkesztése jelenleg közös MediaItemet/borítót is módosíthat: ezekhez külön céljog kell. A több célra író műveletek szükséges részlépéseit előzetesen vizsgáld; tiltásnál ne induljon részleges import vagy folytatódó fallback-írás. Logout, identitás-, repo- vagy jogváltozás érvénytelenítse a korábbi döntést. A jogosultságfelderítés se szivárogtasson privát adatot.

   A `TopNavigationBar` és `MediaLibraryPage` üres adminEmails esetén minden belépettet adminnak vesz; több TimelineView művelet csak loginra támaszkodik; az add-entry route nincs megfelelően védve. Ezeket is fedd le. Productionben korábban egy privát timeline anonim metadata/entry GET-je 200-at adott: ezt igazolt olvasási résként kezeld, de az éles ACL javítása továbbra is külön, később jóváhagyott művelet.

5. **Séma és kliens összehangolása.** A 2026-10-04-i audit szerint az élő MediaItemből hiányzik a checkoutban használt Year; a MediaType értékei eltérnek (`tvseries/tvseason/tvepisode` vs. `show/season/episode`); Rating és BookSeriesNumber korlátokban is van eltérés; SeriesName frontendmezőhöz nincs megfelelő séma. Frissítsd az olvasási képet, és válassz dokumentált, adatkímélő helyi összehangolást, verziózott setup/migrációval. Ne deployold productionbe, és ne tölts ki hiányzó adatot találgatással. Az élő Choice/Reference mezők gyakran tömbök; az MCP egyes válaszai JSON-stringeket tartalmaznak. Ne veszíts adatot primitív mezőlistákra hagyatkozva.

6. **Titkok, karbantarthatóság és ellenőrzések.** A tracked Compose érzékeny konfigurációját vidd megfelelően ignorált helyi konfigurációba, biztonságos példával. Ne írd ki az értékeket, ne rotálj production titkokat. Vite-kliensbe csak publikus konfiguráció kerülhet. Az API key-t logoló proxyútvonalakat is szüntesd meg. Mérd fel az aktuális build/lint/dependency állapotot, és javítsd az M0-hoz szükséges hibákat. Ne végezz indokolatlan keretrendszercserét vagy vak `audit fix --force` frissítést.

## Bizonyítékok korlátai és elfogadási feltételek

A 2026-10-04-i production snapshotban 66 Timeline, Hidden=0 szűréssel 49 timeline (44 publikus/5 privát), 1437 MediaItem-leszármazott és 1428 TimelineEntry volt; ez történeti összehasonlítás, nem friss darabszám. A tárolási gyökér `/Root/Content/timelines`; alatta MediaLibrary és Timelines. A production MCP jogosultságeszközei „SiteUrl is missing” hibát adtak, akár `isError:false` válaszban is: ez nem engedély és nem Visitor-jog bizonyítása. Jogosultságot a támogatott valós SenseNet útvonalon, az adott identitással ellenőrizz; API-key-s admin olvasás nem Visitor-teszt.

A régi build sikerült, a lint 18 hibát/4 figyelmeztetést jelzett, tracked tesztek/CI nem voltak. Ezeket ellenőrizd újra. Alapparancsok: gyökérből `npm run dev`, `npm run build`; clientből `npm run lint`. Új tesztekhez dokumentáld a pontos futtatóparancsot. Windows Git esetén korábban szükséges volt a per-command `-c safe.directory=D:/dev/gitjoe/timeline-theories`; hálózati Schannel-hibánál per-command OpenSSL működött. A gh hitelesítést ellenőrizd újra; korábbi 401-et ne tekints aktuális ténynek.

Az M0 akkor kész, ha valódi helyi backenddel és böngészővel igazolt:

- reprodukálható indulás, helyi auth és tartós adatok; egyértelmű profil, biztonságos default, production-dev írásvédelem;
- az indulás/olvasás nem ír, és 404/401/403/transport hiba nem vált ki létrehozást;
- Visitor, belépett nem író és megfelelő helyi szerkesztő tényleges jogosultságai; a tiltott célműveletet a UI/route/service nem küldi el, megkerült kliens esetén a helyi backend visszautasítja;
- megfelelő joggal működő CRUD, import/reorder/upload és privát hozzáférés, a jogosultsági részlépések és identitásváltás próbáival;
- teljes restore-ellenőrzés referenciákkal, mezőkkel, sorrenddel és borítókkal, majd újraindítás utáni használat;
- build, lint és arányos automatizált regressziós/integrációs tesztek, valamint rövid, másolható kézi smoke-lépések.

Mock, offline próba, exportfájl vagy health endpoint nem helyettesíti ezeket. Valódi külső blocker esetén fejezd be a független munkát, pontosan mondd meg, mi hiányzik, és ne jelents kész M0-t a nem futtatott ellenőrzések helyett.

## Munkamenet és handoff

Indulj egy rövid állapotellenőrzéssel és konkrét végrehajtási tervvel, majd dolgozz önállóan a teljes M0-n. Használj egy `feature/m0-local-foundation` ágat; meglévő névütközésnél előbb vizsgáld meg, kihez/milyen munkához tartozik. A fontos, később visszakeresendő döntéseket, parancsokat és gotchákat mentsd moduláris Obsidian-jegyzetekbe, frontmatterrel, tagekkel, wikilinkkel és indexkapcsolattal. A helyi runtime-adatok/mentések/titkok megőrzését ellenőrizd commit előtt. Csak átnézett fájlokat stage-elj explicit; ne használj `git add .`-ot.

Befejezéskor legyen belső diff-review és a szükséges javítások, commit/push, developra célzott PR, a PR csatolása ehhez a chathez, friss dokumentáció és Obsidian-handoff. Adj branch/commit/PR hivatkozást, pontos tesztparancsokat és rövid kézi ellenőrzőlistát. Külön nevezd meg a ténylegesen lefuttatott bizonyítékokat és a fennmaradt korlátokat. Merge és deploy nálam marad.

A teljes UI-újratervezés, Trakt import tartalmi/időrend/pagination javítása, veszteségmentes publikus export mint termékfunkció, a production login/ACL javítása és az agent API későbbi szelet. Az M0-ban ezekhez csak a szükséges biztonsági és adatmegőrzési alapokat készítsd el. A jövőbeli app-agent kapcsolatnál közvetlen HTTPS/JSON/OpenAPI jellegű elérést szeretnék, kötelező MCP/connector-regisztráció nélkül; ennek részletes terveit majd külön megbeszéljük. A mostani SenseNet MCP auditcsatorna, nem a jövőbeli app API.
