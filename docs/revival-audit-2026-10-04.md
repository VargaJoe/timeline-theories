# Timeline Theories állapotfelmérés és folytatási javaslat

A projekt eredeti célja továbbra is jól illeszkedik Joe igényéhez: személyes, vegyes médiájú listák létrehozása saját in-universe kronológia, kiadási sorrend vagy más kutatási szempont szerint. A működő [Timeline Theories oldalt](https://timelines.vargajoe.hu/), a meglévő importált listákat és a MediaItem–TimelineEntry kapcsolatot fejlesztjük tovább. Minden lista Joe által elfogadott sorrendet és álláspontot képvisel; ennek megőrzése a helyreállítás alapja. Az újraindítást helyi SenseNet fejlesztői repositoryval, adatmegőrzéssel, az importok és a hozzáférési szabályok javításával javaslom kezdeni, majd ugyanarra az alkalmazási szolgáltatásrétegre építeni a felületet és a külső agent API-t.

Ez a 2026. október 4-i felmérés és terv, nem implementációs döntés. Alkalmazáskódot, éles adatot, jogosultságot és deploymentet nem módosítottam. Az alábbi készültségi megállapítások külön jelzik a kódvizsgálatot, a futtatott próbákat és az ellenőrizetlen részeket.

## Eredeti cél és megállási pont

Az eredeti `docs/kickoff.md` személyes, többféle médiaformátumot összekötő kronológiaeszközt ír le. Fontos elemei a több listában újrahasználható mű, egy mű többszöri előfordulása ugyanabban a listában, saját sorrend és megjegyzések, külső hivatkozások, megosztás és keresés. Az első terv Supabase/Netlify környezetet javasolt; a tényleges megoldás SenseNet tartalomtárra és React felületre épül. A README a személyes kutatást és saját értelmezést hangsúlyozza.

Az ellenőrzött helyi és távoli `develop` HEAD egyaránt `04990d3b8f9f3dec667dde40141e90f5f9b0c0d5`. Az utolsó commit 2026. január 28-án az ABC-lapozó bejelentkezés utáni frissítését javította. Előtte publikus képek betöltése és helyi MSSQL-adatmegőrzés javítása történt. A későbbi nagyobb funkcionális lépések időrendben:

- 2025. július: Trakt-import, TV-adatok javítása, kártyák és timeline-szerkesztés.
- 2025. szeptember: média létrehozása bejegyzés hozzáadásakor, privát timeline és adminfelület.
- 2025. december: könyves/kiadói lista, könyvimport, ZIP/TSV export és import, kettős hitelesítés, képek és lekérdezések optimalizálása.

A GitHub API ellenőrzésekor 11 nyitott PR volt, mind függőségfrissítés; nyitott önálló issue nem volt. A `feature/apikey-using-visitor-mode` ág is létezik, de a friss funkcionális kiindulópont a develop. Az audit indulásakor a munkafa tiszta volt.

A `docs/implementation-tasks.md` nem megbízható készültségi nyilvántartás: ugyanaz a Story 29 a Planned és Completed részekben is szerepel; Story 06 szervezési feladatai tervezettként maradtak, miközben Story 12 hasonló műveleteket késznek jelöl. A Story 28 száma két eltérő funkcióhoz is kötődik. A régi jelöléseket új, viselkedésalapú elfogadási feltételekre kell átvezetni.

## Meglévő képességek

| Terület | A kódban meglévő képesség | Bizonyítás és korlát |
| --- | --- | --- |
| Timeline | Létrehozás, szerkesztés, törlés, listázás, név szerinti URL, láthatóság, ABC és All nézet | Kódvizsgálat és élő olvasás; íróműveletet nem futtattam |
| Médiatár | Film, sorozat, évad, epizód, könyv, képregény, játék és további típusok; leírás, borító, hivatkozások | A külön MediaItem adattípus és CRUD szolgáltatás megvan |
| Előfordulás | TimelineEntry egy MediaItem-re hivatkozik; pozíció, dátum, kronológiai szöveg, jegyzet, fontosság és opcionális jelölés | Jó alap, de a mezők végigvezetése hiányos |
| Rendezés | Drag and drop és kézi pozíció; könyves listához publikációs rendezési kód | A kronológiai/kiadási beállítás nem vezérli rendesen a normál nézetet |
| Trakt | Listacím feldolgozása, film/show/season/episode leképezés, új és meglévő timeline importút | Két eltérő végrehajtás; részletes hibák lent |
| Könyvimport | Open Library és Google Books keresés, könyves adatok, több könyv importja | Kód megvan; hiteles, teljes könyvsorozat importját nem bizonyítottam |
| Adatdúsítás | OMDb, TMDB, Trakt és tömeges frissítés; változáselemzés és rate-limit kezelési kód | Éles szolgáltatói frissítést nem futtattam |
| Export és import | ZIP borítókkal és 19 oszlopos TSV; név szerinti bejegyzésfrissítés | Nem önálló, veszteségmentes mentési formátum |
| Auth | SenseNet SNAuth/IdentityServer felderítés, OIDC/JWT környezetek, felületi adminfeltételek | Az éles anoním olvasás bizonyított privacy-hiányt mutatott |

A klónozás/forkolás, timeline-ok közötti kereszthivatkozás, bejegyzések univerzum/loop/tag szerinti kezelése, egyesített többtimeline-nézet és olvasási haladás a régi backlogban szerepel; a vizsgált alkalmazási modellben és útvonalakon nincs kész megvalósításuk. A README több ilyen képességet túl határozottan állít.

## Futtatott ellenőrzések

`npm.cmd run build` a client mappában sikeres. A fő JavaScript csomag körülbelül 1,43 MB, gzipelve 373 KB; a build nagy csomagra figyelmeztet. Ez optimalizálási jel, nem mért böngészős teljesítmény.

`npm.cmd run lint -- --format json` eredménye 18 hiba és 4 figyelmeztetés 53 vizsgált fájlban. A hibák explicit `any`, nem használt változók és React export/szabály kérdések között oszlanak meg. Verziókövetett automatizált tesztfájlt és CI workflow-t nem találtam.

`npm.cmd audit --json` a client függőségi gráfjában 53 érintett csomagbejegyzést jelentett: 30 high, 14 moderate, 9 low, 0 critical. Ez nem 53 külön sérülékenységet jelent, és a gráf fejlesztői függőségeket is tartalmaz. Külön frissítési és regressziós munkára van szükség; automatikus javítást nem alkalmaztam.

Az `.env.local` szervere `https://localhost:41016`; ez a felméréskor nem fogadott kapcsolatot. A másik helyi beállítás `https://localhost:51016`, amelyen a HTTPS-ellenőrzés protokollhibát adott. A Docker daemon és a Docker konfiguráció a jelenlegi sandboxból nem olvasható. Ezekből nem következik a teljes helyi infrastruktúra állapota.

A `.env.prod` által jelölt cloud SenseNet szerver sikeresen válaszolt. A kizárólag GET-tel ellenőrzött pillanatkép:

- 66 tárolt Timeline; a normál alkalmazási `+Hidden:0` lekérdezés 49-et talált, ebből 44 publikus és 5 nem publikus.
- 1437 nem Hidden MediaItem és 1428 nem Hidden TimelineEntry.
- Egy konkrét, `IsVisible:false`, `Hidden:false` timeline metaadata és a bejegyzésgyűjteménye hitelesítés nélküli GET-tel 200 választ adott.

Ezek pillanatnyi API-számok, nem teljes adatintegritási audit. Egyes importált elemek típus és használható cím nélkül is láthatók voltak a mintában. Az összes hiány, duplikáció és hibás hivatkozás számszerűsítése a helyreállítás része.

A korábbi auditpróbában a helyi Vite felületet átmeneti környezeti változókkal az élő olvasási környezetre állítva indítottam, forrás- vagy env-fájl módosítása nélkül. A böngésző a fejlesztői tanúsítványt elutasította: IP-címmel néveltérés, localhosttal lejárt tanúsítvány. Ez a helyi visual smoke nem sikerült; biztonsági figyelmeztetést nem léptem át, a helper szervert leállítottam. Joe ezt követően rögzítette, hogy a fejlesztéshez az M0-ban külön helyi SenseNet repositoryt kell indítani. Az éles repository nem fejlesztői cél: a további fejlesztés, import- és írópróbák kizárólag helyben történhetnek.

Joe megadta a publikált webcímet: https://timelines.vargajoe.hu/. A nyilvános oldalt böngészőben ellenőriztem: a timeline-lista és az Alien–Predator–Blade Runner Shared Universe részletes oldala betöltött, a számozott lista, a leírás és a borítók megjelentek. Az ABC-nézet és a konkrét lista olvasási útja tehát éles környezetben is működött. Ez nem szerkesztési, import- vagy teljes reszponzivitási bizonyíték; a deploy és a develop pontos verzióegyezését nem igazoltam.

**Utólag feltárt mellékhatás:** Joe a production naplóban 20:03:34-kor a `/Root/Content/timelines/MediaLibrary` Folder létrehozásának hibáját találta. Az alkalmazás induláskor automatikus létrehozást próbálhat; ezt a böngészős ellenőrzés előtt nem vettem észre. Az éles `/assets/index-B5F6ZfNy.js` csomag közvetlen GET olvasása is igazolta az automatikus setupot és a Folder POST ágát. A látogatásom ezért nagy valószínűséggel kiválthatta a naplózott próbát; kérésazonosító/IP/időzóna egyeztetés nélkül az adott kérés hozzám rendelése nem bizonyított. Közvetlen létrehozási kérést vagy szerkesztési műveletet nem indítottam, de a felület megnyitását nem lehet mellékhatásmentes olvasási ellenőrzésnek nevezni. A naplózott mentés meghiúsult; ebből más kérés vagy más adat változatlanságát nem állítom.

Joe szerint jelenleg nem működik a SenseNet-belépés, és SenseNet problémának tűnik. Ez külön javítási feladat. Az auditban nem indítottam belépést vagy auth-javítást; a szolgáltatói eredet még nem igazolt diagnózis.

### Env beállítások és a localhost kapcsolat oka

Joe tesztbeállításokat tart a gitignored `.env.itteni`, `.env.prod` és más env-fájlokban, és a kiválasztott fájlt kézzel másolja a `client/.env` helyére. Az ellenőrzéskor a `.env` már a production repository címét tartalmazta, a `.env.local` viszont `https://localhost:41016` értéket adott meg. A telepített Vite 7.1.11 `loadEnv` függvényével, szerverindítás és hálózati kapcsolat nélkül ellenőriztem a tényleges betöltést:

| Vite mód | Tényleges repository cél |
| --- | --- |
| development, a normál `npm run dev` | `https://localhost:41016` |
| production, a normál `npm run build` | `https://localhost:41016` |
| prod, explicit módválasztás | `https://plastice.sensenet.cloud` |

Az ok a prioritás: `.env` → `.env.local` → `.env.[mode]` → `.env.[mode].local`; az azonos kulcsot a később betöltött fájl felülírja, a Vite indítása előtt már létező process környezeti változó pedig mindegyiknél erősebb. A próbában a vizsgált kapcsolódási kulcsoknak nem volt process felülírása. A `.env.prod` neve csak `--mode prod` mellett automatikus, nem jelent `.env.production` fájlt. A `.env.itteni` és `.env.miez` normál development indításnál nem töltődik be. Env-módosítás után a Vite szervert újra kell indítani; a módválasztás nem ugyanaz, mint a Node development/production működés vagy a Trakt live/fixture forrásválasztása. [Vite env és mód dokumentáció](https://vite.dev/guide/env-and-mode)

Az aktuális env-ekből hibrid beállítás is összeállhat: helyi repository, de a `.env`-ből megmaradó cloud OIDC authority. Ez konfigurációs keveredés, nem a production SenseNet-belépési hiba diagnózisa. A compose fájl a 41016/41017 portokat tartalmazza; az `.env.itteni` és `.env.miez` 51016/51017 értékeinek jelenlegi használhatósága nincs igazolva.

Az env-rendezés az M0 része: explicit, dokumentált helyi fejlesztői és production-ellenőrzési profil; a backend-címeket rejtetten felülíró általános `.env.local` megszüntetése vagy közös, környezetfüggetlen adatokra korlátozása; egyértelmű indítási parancsok; titok nélküli effektív repository/mód kijelzése; a production írópróbák kizárása a fejlesztői útból. A jelenlegi variációkat előbb fel kell térképezni és megőrizni, majd a működő helyi példányhoz egységesíteni. Ebben az auditban env-fájlt nem módosítottam és környezetet nem kapcsoltam át.

## Konkrét hibák és következmények

### Production backend közvetlen MCP-auditja

A Joe által beállított `sensenet-plastice` kapcsolaton közvetlenül ellenőriztem a tartalomtárat. A [külön backend tárolási audit](backend-storage-audit-2026-10-04.md) rögzíti az élő fa szerkezetét, a MediaItem–TimelineEntry–Timeline kapcsolatot, a könyv-leszármazottat, az XML sémákat és a kóddal való eltéréseket. Az elemszámok MCP-n is egyeztek a korábbi GET pillanatképpel.

Fontos új M0-feladat a **kliens, checkout XML és élő séma összeegyeztetése**: az élő MediaItem-ben nincs Year mező, a Choice választék és néhány validáció is eltér. A 911 mintában három külön epizód külön művekre hivatkozik, de Title/Subtitle hiányzik és a külső azonosító-JSON mindháromnál azonos.

A MediaLibrary létezik, a jelenlegi API-kulcsos root-lekérdezés Foldert is tartalmaz az AllowedChildTypes listában. Ez nem Visitor-műveleti jog és nem legitimálja az automatikus létrehozást. Nem volt szándékos új tartalom-létrehozás; a hibás alkalmazási próba oka ismert: load-hiba után create, jogellenőrzés nélkül. A megelőző load-hiba oka külön kérdés. Az MCP jogosultságolvasása SiteUrl-kontextushibával meghiúsult; az anonim GET privacy-bizonyíték ettől független. Ez az MCP-vizsgálat kizárólag olvasó eszközöket használt, production tartalmat és jogosultságot nem módosított.

### Trakt import

1. Fejlesztői módban a `client/services/traktService.ts:163` először a verziókövetett `/example-trakt-response.json` fájlt tölti be. Ha ez sikeres, a kért felhasználó és lista nem jut el a Trakthoz. Ezt futtatott, hálózat nélküli forráspróba is megerősítette.
2. A mapper eldobja a lista `rank`, `notes` és listabeli `id` mezőit. Évadhoz és epizódhoz a show azonosítóit adja vissza, nem az epizód/évad saját azonosítóit. A kimeneti tömb API-sorrendje így eltérhet a személyes rank-sorrendtől.
3. A `TimelineCreateForm.tsx:54` út az `item.title` értékkel azonosít és hoz létre médiát. Több epizódnál ez ugyanaz a sorozatcím; a formattedTitle, a részazonosítás és a Year mező nem kerül megfelelően a mű rekordjába. A meglévő timeline-on használt `TraktImportDialog.tsx:118` eltérő, formattedTitle-alapú logikát használ. Mindkettő minden importált elemnél újra lekéri a médiatárat, és olvasási hibát is „nem találtam” eredménynek tekinthet.
4. A meglévő timeline importja a média alapján kihagy ismétlődő előfordulásokat, pedig az eredeti cél szerint ugyanaz a mű többször is szerepelhet. A kihagyások után a pozíció a forrás tömbindexéből képződik, nincs megbízható folytatás/egyeztetés.
5. A Netlify proxy egyetlen listakérést végez, lapozás és teljes darabszám-ellenőrzés nélkül. A Trakt hivatalos 2026-os közleménye szerint kötelezővé vált a lapozás: április 15-re 100 elem alaplimit, június 15-től 250 elem maximális oldalméret szerepel a frissítésben. A mai kód ezért hosszabb listából csak az első oldalt importálhatja. Ez forrás és kód alapján levont következtetés; valódi Trakt-lista letöltését nem futtattam. [Hivatalos közlemény](https://github.com/trakt/trakt-api/discussions/681)
6. A proxy teljes Trakt API-kulcsot írhat a logba, és kulcsrészleteket tehet hibaválaszba. A továbbított bearer token a SenseNet-kulcs betöltésére szolgál; nincs külön Trakt OAuth-folyamat a privát Trakt-listákhoz.
7. A `.cjs` handler `require('./sensenet')` hívása a client ESM csomagjában CommonJS-ként írt `.js` helpert tölt. A közvetlen helyi Node-próba 500-at és `module is not defined in ES module scope` hibát adott. A Netlify bundler ezt kezelheti eltérően; a telepített function még ellenőrizendő.

### Kronológia és adatok

A `TimelineViewPage.tsx:227` normál timeline esetén mindig position szerinti betöltést kér. A `SortOrder` kapcsoló és a `ReleaseOrderPosition` mező nincs érdemben összekötve a nézet rendezésével. Ez technikai következetlenség, nem bizonyíték arra, hogy Joe elfogadott listabeli sorrendje hibás lenne. A megőrzött pozíció az elsődleges szerkesztői sorrend; új automatikus rendezés ezt nem írhatja felül. A kronológiai dátum szigorú DateTime, ami önmagában nem kezeli a BBY/ABY, relatív, bizonytalan vagy párhuzamos időrendet.

A `TimelineEntryService.ts:58` nem választja ki a `ChronologicalDescription` mezőt, de a mapper és a felület használni próbálja. A bővített médiareferenciából több exportálandó könyv- és kiadási mező is hiányzik. A SenseNet Choice értékek az élő válaszban tömbök; több szolgáltatás/string összehasonlítás nem normalizálja ezeket. Például a publisher-series egyenlőségvizsgálatánál ez a megfelelő rendezési ág kiválasztását is érinti.

A sorrend mentése több független PATCH. Részleges hiba vagy párhuzamos agent/felhasználói szerkesztés ellen nincs alkalmazásszintű verzióellenőrzés és atomikus garancia.

### ZIP export és import

A felület által használt `timelineExportService.ts` és `timelineImportService.ts` mellett a `timelineService.ts` külön TSV/ZIP implementációkat is tartalmaz. A felület újabb útján az archívum belső numerikus media_id-t őriz; az import nem építi újra a művet és külső azonosítóit. Másik repositoryban ez hiányzó vagy téves hivatkozást jelenthet.

A 19 oszlopos archívum kihagyja többek között a kiadási pozíciót, arcGroup és isOptional értékeket, a médiakapcsolat stabil külső azonosítóit és a timeline saját metaadatait. Több könyvmezőt beolvas, de az import nem írja vissza a műre. A jelenlegi export/import egy hálózat nélküli, valódi forráskódot futtató próbában elvesztette ezeket az adatokat; ez nem éles restore-próba. Az import összefoglalója és hibái a felületen főleg konzolba kerülnek.

### Hozzáférés

A lista frontend query-je `IsVisible:true` szűrővel rejti a nem publikus elemeket; a detail page hitelesítést ellenőriz. Az élő anoním GET bizonyította, hogy ez az ellenőrzött privát elemnél nem helyettesíti a SenseNet szerver jogosultságát. Írási jogosultságot és más account hozzáférését nem teszteltem. A javítás célja szerveren érvényesülő olvasási és írási szabály, majd ehhez illesztett felületi viselkedés.

### Automatikus írás az oldal megnyitásakor

Joe pontosítása alapján ez nem valós, szándékos új elem létrehozása volt. A Folder POST ezen az olvasási útvonalon érvénytelen alkalmazási művelet, és a Visitor létrehozási joggal sem rendelkezik. A [műveleti/jogosultsági audit](operations-permissions-audit-2026-10-04.md) az egész kliens indítási kapuit és az M0 ellenőrzési tervét rögzíti.

A `client/scripts/setupMediaLibrary.ts:43` már a modul importjakor elindítja a setupot, az `App.tsx:37` pedig mountkor ismét meghívja. A `repository.load` bármilyen hibáját — hálózat, hitelesítés, jogosultság vagy hiány — a catch nem létező mappaként kezeli. Ezután a projektgyökér alatt `Folder` létrehozását próbálja `DisplayName: MediaLibrary` adattal. A Joe által adott napló ezt a mentést a Workspace által nem engedélyezett Folder típus miatt utasítja el. A megelőző load-hiba konkrét oka nincs megállapítva; ez nem bizonyítja, hogy a médiatár hiányzik.

M0-ban az import és az oldalbetöltés automatikus írását meg kell szüntetni. A tartalomtár struktúrájának előállítása külön, explicit helyi provisioning/migráció legyen, ellenőrzött célon és jogosultsággal. A javítás elfogadási feltétele, hogy puszta oldalbetöltés és olvasás nem indít POST/PATCH/DELETE kérést; egy load-hiba nem vált ki létrehozást. A production séma vagy AllowedChildTypes módosítása nem az audit része.

## A meglévő termékmodell továbbfejlesztése

Az alapfogalmak maradjanak egyszerűek: **mű**, **listabeli előfordulás**, **timeline/gyűjtemény**. Ennek tárolási modellje már megvan: **MediaItem → TimelineEntry → Timeline**. A Timeline tartalom a TimelineEntry gyerekeket tárolja, a TimelineEntry pedig egy MediaItem-re hivatkozik; a művek külön, újrahasználható médiatárban vannak. Ezt megtartjuk és az import/szerkesztési útvonalakon következetesen érvényesítjük. A mű címét, epizódazonosítóit, kiadási adatait és borítóját egyszer tároljuk; minden előfordulásnak külön sorrendje és saját jegyzete legyen. A média deduplikációja és az előfordulások összevonása két külön művelet. Az utóbbi nem lehet automatikus mellékhatás.

Elsőként a kézzel kutatott sorrendet kell veszteségmentesen megőrizni. Ettől független nézet legyen a valós kiadási sorrend, és a gyűjtemény jelölhesse a rendezési alapot: in-universe, release, ajánlott fogyasztási sorrend vagy saját. Az in-universe időleírás támogasson szabad szöveget és rendszermegjelölést; a hiányzó pontos dátum ne akadályozza a rendezést. Részlet/fejezet/idősáv és relatív „előtte/utána” kapcsolatok később, a meglévő listák konkrét igényei alapján bővíthetők.

A közzétett lista minden esetben Joe álláspontját képviseli, akár canon, stúdió- vagy alkotói szándék, akár saját következtetés alapján állította össze. A történetek in-universe és canon státuszát nem egyetlen entitás dönti el; az alkotói állítások is ellentmondhatnak egymásnak. Ezek feloldása Joe szerkesztői döntése, amelyet a lista leírásában fejthet ki. Az alkalmazásnak nem feladata hivatalos vagy objektív canon meghatározása és érvényesítése. Opcionális universe/continuity/canon jelölések később segíthetik a rendezést és szűrést, de nem lehetnek kötelező mezők vagy az alapfolyamat adminisztrációs feltételei. Egy AI által talált dátum vagy javasolt sorrend tervezetként, forrással és bizonytalansággal jelenjen meg; Joe elfogadott sorrendjét adatdúsítás ne módosítsa automatikusan.

A felület fejlesztése a létező oldalra és a már importált listákra épül. A módosításokat néhány meglévő, vegyes és epizódos lista helyi másolatán kell ellenőrizni. Kezdőoldali keresés, olvasható sűrű lista, az elfogadott sorrend egyértelmű megjelenítése, mű és előfordulás külön szerkesztése, egyértelmű importelőnézet és részleges hibaüzenet fontosabb, mint új discovery/trending funkció. A vizuális irányt meglévő tartalommal, asztali és mobil példán kell ellenőrizni.

## Javasolt agent kapcsolat

Közvetlen HTTPS JSON API-t javaslok, stabil `/api/v1` útvonalakkal, felfedezhető capability leírással és OpenAPI dokumentummal. Az OpenAPI HTTP API-k gépi megértésére szolgáló nyílt leírás, önmagában nem connector-regisztráció. [OpenAPI specifikáció](https://spec.openapis.org/oas/latest.html)

Egy agent az alapcímet és a neki kiosztott tokent kapná meg; utána HTTP-kérésekkel használhatná a képességeket. Ettől nem kell külön agentfelhasználót regisztrálni vagy MCP-szervert bekötni. Az egyszeri biztonságos jogosultságadásra szükség van; hitelesítés nélküli író API-t nem javaslok. A hálózati elérés módját és a token tárolását később, a tényleges host/harness alapján kell kiválasztani. Az adott agentkörnyezetnek természetesen HTTP-hívási lehetőség és a szükséges hozzáférés kell.

Az API első képességei: timeline/média keresése és olvasása, kapcsolódó előfordulások megkeresése, import vagy metadatafrissítés előnézete. Ezt kövesse mű/előfordulás létrehozása és szerkesztése, ellenőrzött teljes sorrendmentés és megtekinthető változásnapló. A tömeges módosítás két lépése preview és apply legyen; az apply verziót és ismétlési azonosítót ellenőrizzen, hogy újraküldéskor ne keletkezzen duplikáció. A preview ne járjon írással.

A felület és az API ugyanazokat az alkalmazási műveleteket és validációkat használja. A SenseNet kezdetben tárolási adapter maradhat; általános SenseNet-adminvégpontot vagy frontend service-ek DOM-függő másolatát ne tegyünk az agent API mögé. A jelenlegi szolgáltatások böngészői környezetre és közvetlen repository-műveletekre támaszkodnak, ezért közös domainréteg és szerveroldali határ szükséges.

Ehhez az első szakaszban nem kell az alkalmazásba saját LLM-et telepíteni. A külső agent végezheti a kutatást és hozhat tervet; az alkalmazás a szabályokat, az adatot és az elfogadott változást kezeli. Az API konkrét frameworkjét, tárhelyét és a SenseNet megtartását most még nem választottuk ki véglegesen.

## Javasolt mérföldkövek

| Szakasz | Eredmény | Elfogadási feltétel |
| --- | --- | --- |
| M0 Adatmegőrzés és helyi fejlesztői környezet | Külön helyi SenseNet repository indítása; env-variációk megőrzése és rendezése explicit profilokká; egyértelmű indítási parancsok és tényleges környezet kijelzése; automatikus frontend setup helyett explicit helyi provisioning; olvasható teljes snapshot és restore-próba helyi/izolált célon; adathiányok és duplikációk jelentése; szerverjogosultságok, titoklogok és függőségek rendbetétele | A fejlesztői felület és író/importpróbák helyi repositoryt használnak; a cél ellenőrizhető, általános env nem írja felül rejtetten; az éles írás kizárt a fejlesztői útból; puszta oldalbetöltés/olvasás nem indít írókérést; a művek, előfordulások, leírások, jegyzetek, elfogadott pozíciók, azonosítók és borítók restore után egyeznek; a célkörnyezet privát adata anonim hívásra megtagadott; build/lint és érdemi smoke sikeres |
| M1 Megbízható import és időrend | Egy közös Trakt pipeline, explicit forrásmód, teljes lapozás, rank/notes és entity IDs megőrzése, importterv és hibaegyeztetés; stabil médiaazonosság; veszteségmentes verziózott formátum; működő sorrendnézetek | 250-nél hosszabb lista teljes; újrafuttatás idempotens; egymást követő epizódok külön művek; ismételt előfordulás megmarad; részleges hiba után folytatható; kiadási nézet nem írja át a kutatott sorrendet |
| M2 A meglévő felület fejlesztése és olvasó agent API | Meglévő listák helyi másolatain ellenőrzött, mobilon is működő olvasási és szerkesztési út; közös domainréteg; capability és OpenAPI; keresés/olvasás/importelőnézet | Valódi felületi smoke helyi repositoryval és ugyanazon adat olvasása HTTP-ből, böngésző nélkül; a meglevő listák tartalma és elfogadott sorrendje megmarad; az importeredmény a felületen látható; preview nem ír |
| M3 Ellenőrzött agent írás | Mű és előfordulás kezelése, metadatajavaslat, sorrendmentés, preview/apply, token scope, verzió- és ismétléskezelés, napló | Valódi külső agent saját teszttimeline-on végigviszi a folyamatot; ismételt kérés nem duplikál; közben végzett kézi szerkesztés nem vész el; jogosulatlan művelet megtagadott |
| Későbbi funkciók | Opcionális universe/canon jelölés, cross-reference, párhuzamos/karakterkronológia, klónozás, részletekre bontás | A meglévő listák használata alapján külön priorizálás; a jelölések nem kötelezőek, a szerkesztői döntés Joe-é |

A négy szakasz javasolt sorrend, nem elfogadott implementációs megbízás. A régi Story 18–20 rating/trending/discovery funkciókat és Story 30 saját könyvtár/haladás irányát most hátrébb sorolnám. A Story 25–27 kapcsolódási és többtimeline-ötletek a célhoz illenek, de a stabil előfordulás- és sorrendmodellre kell épülniük.

## Következő konkrét lépés és nyitott döntések

M0-ban az élő XML sémák és a helyi deployment-definíciók különbségeit is tételesen egyeztetni kell. Az élő séma megőrzendő kiinduló bizonyíték; a helyi provisioning tudatos, verziózott döntés legyen, és a kliens által használt mezőknek legyen ellenőrzött megfelelőjük. A későbbi local MCP-vel a típusok, elemszámok és konkrét hivatkozások ugyanilyen módon visszaellenőrizhetők.

M0-ban a műveleteket tényleges céljogokhoz kell kötni: a login és az adminnak tűnő UI nem jogosultság. A tiltott művelet ne legyen indítható, és route/handler/service szinten se küldjön írókérést. A privát olvasás is céljogot igényel. A backend ACL külön érvényesítendő; Visitor, bejelentkezett nemíró és jogosult szerkesztő helyi végponti ellenőrzése szükséges, beleértve a 404/401/403/transport hibák és logout/jogváltás kezelését. Ez még terv és audit, nem elkészült kódjavítás.

Következőként az M0 helyi környezetét, adatmegőrzési és integritási munkáját érdemes pontosítani: külön helyi SenseNet repositoryt indítani, az éles snapshotot biztonságosan előállítani, helyben/izoláltan visszaállítani, és számszerűen kimutatni a hibás médiákat, hiányzó referenciákat és importból megmaradt duplikációkat. A fejlesztői írás és import kizárólag erre a helyi példányra irányulhat. Éles javítás vagy adatmigráció csak az elkészült előnézet alapján következzen. A production SenseNet-belépés hibáját külön feladatban vizsgáljuk és javítjuk.

A publikált webcím ismert és ellenőrzött: https://timelines.vargajoe.hu/. A kívánt hosszú távú hosting még tisztázandó. A backend megtartásáról csak a mentés/restore, jogosultságok, üzemeltetési költség és szerveroldali API-hozzáférés bizonyítékai után indokolt dönteni; az M0 helyi repository követelménye ettől függetlenül rögzített. A meglévő listák közül választunk reprezentatív ellenőrzési mintát. Az opcionális jelölések részletessége és a direkt agentkapcsolat konkrét kialakítása későbbi közös döntés.

## Ellenőrzési parancsok és források

```powershell
Set-Location D:\dev\gitjoe\timeline-theories\client
npm.cmd run build
npm.cmd run lint -- --format json
npm.cmd audit --json

Set-Location D:\dev\gitjoe\timeline-theories
node.exe temp/audit-behavior-probes.cjs
git -c safe.directory=D:/dev/gitjoe/timeline-theories status --short
```

Az utolsó Node-parancs az audit során létrehozott, gitignored `temp` forráspróba. Valódi mapper/export/import kódot futtat szintetikus transporttal; nem helyettesít éles Trakt-importot vagy teljes restore-próbát. A build/lint/dependency audit nyers kimenetei szintén a gitignored temp mappában vannak. Titkot és éles médiakatalógus-dumpot nem mentettem ide.

Elsődleges repository-források: `docs/kickoff.md`, `docs/implementation-tasks.md`, `docs/stories/story25*`, `story26*`, `story27*`, `story29*`, `story30*`, `story31*`, `story32*`, a content type XML-ek, `client/services/*`, `TimelineCreateForm.tsx`, `TraktImportDialog.tsx`, `TimelineViewPage.tsx` és az auth komponensek. Az Obsidianban korábbi Timeline Theories projektjegyzetet nem találtam; az új projektáttekintés és audit a Software Development indexbe kapcsolódik.
