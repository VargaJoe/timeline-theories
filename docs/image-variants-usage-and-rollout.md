# Statikus borítók és képméretek a kliensalkalmazásban

Ág: `feature/sensenet-image-variants`, PR #62. A kliens/app megoldás standard SenseNet Folder/File tárolással elkészült; az alábbi helyi ellenőrzések 2026-11-06-án sikeresek. A korábbi, elvetett bővítmény natív képtesztjei nem ennek az elfogadási bizonyítékai.

## Határ és működés

A böngésző készíti a képeket. A meglévő alkalmazás API-ja a SenseNet standard HTTP-műveleteivel menti és olvassa őket. Nincs új szerveroldali SenseNet-kód, DLL, saját content handler, natív képművelet, Skia-dekóder, új tartalomtípus vagy új mező. A meglévő helyi M0 tesztkörnyezet eredeti beállításai ettől külön maradnak.

A timeline-borító a jelenlegi, legfeljebb négy poszteres statikus kompozíció. A választás, sorrend és Random eredménye elmentődik. A média méretei a kis kártyához és a nagyobb részletnézethez használhatók. Az interaktív kártyanézet későbbi feladat.

## Tárolás

```text
<timeline vagy média>
  CoverImageBin / CoverImageUrl       meglévő eredeti, változatlan
  (images)/                          standard SystemFolder, IsSystemContent=true
    Description                      alkalmazási kötés + aktív készlet
    <generationUUID>/                standard Folder
      Description                    recept, forrás-hash-ek, manifest, lezárt állapot
      w400.webp                      standard File.Binary
      w800.webp
      w1200.webp
```

Médiánál a logikai méretek tipikusan `w160`, `w320`, `w640`. Kis eredetit nem skálázunk fel. A tényleges fájlnév a formátumnak megfelelő kiterjesztést kap; PNG-fallback esetén `.png`.

A `(images)` valódi, beépített **SystemFolder**: a rendszerjelölést a típus adja, nem önmagában a zárójeles név. Alapértelmezett autofilterrel a képtároló és leszármazottai kimaradnak a tartalmi találatokból. SenseNet adminban kapcsold ki az autofiltert; lekérdezésben `.AUTOFILTERS:OFF` mellett láthatók. Az app belső generáció- és fájlfelsorolásai ezt kifejezetten használják; a közvetlen, jogosultsággal védett ID-/útvonal- és binárisolvasás továbbra is működik. A rendszerjelölés nem jogosultsági korlát.

A rendszer-mappa saját `AllowedChildTypes` beállítása csak `Folder,File`; a generációk standard Folderek, a képek standard File tartalmak. Az előző verzió `_images` Folder tárolója kötésellenőrzött kompatibilis olvasással megmarad, és olvasáskor nem alakul át automatikusan. Meglévő készlet átállításakor azonos tulajdonos alatt hozd létre a `(images)` SystemFoldert, másold a vezérlőleírást, majd az UUID generációs mappákat standard Move művelettel mozgasd át. A generáció- és File-ID-ket, manifestet, aktív készletet és képbyte-okat őrizd meg; csak az ellenőrzötten üres régi mappát töröld. Ezt írásmentes/karbantartási időben végezd; a két tároló közti mozgatás nem atomi.

A szerkesztőnek a tulajdonos tartalmon szükséges írás/létrehozás mellett a beépített **SystemFolder tartalomtípust is látnia kell**. Az app ezt ellenőrzi, jogosultságot nem oszt. A helyi M0Editor a meglévő SystemFolder típuson kizárólag helyi See/Open jogot kapott; típusszerkesztési, séma- vagy ACL-módosítási jogot nem. Más repositoryban a meglévő szerkesztői szerepkör megfelelő típusláthatóságát az admin ellenőrizze. A tulajdonos eddigi Folder/File engedélyezési jelölése megmarad, hogy a még nem inicializált régi tartalmak olvasásakor ne kelljen minden elem alatt külön tárolót keresni.

A Folder saját, már létező `Description` mezője tárolja a korlátozott méretű JSON-adatot. Ez az alkalmazás újonnan létrehozott mappáinak leírása; az eredeti timeline/média leírását nem írjuk át. Az aktív generáció kiválasztása ennek a kis vezérlőadatnak a mentése. A korábbi készlet a teljes új feltöltés és ellenőrzés alatt használható marad.

Az első elkészítés az adott elem **meglévő** `AllowedChildTypes` tartalmi beállításához hozzáadja a standard Folder/File gyermekeket, a korábbi engedélyezett típusok megtartásával. Ez normál, az aktuális felhasználó jogosultságaival végzett tartalommentés. Nem globális séma-, ACL- vagy szerverkód-telepítés. A timeline-bejegyzések továbbra is közvetlen TimelineEntry gyermekek; a képmappa nem számít be közéjük.

Minden eredeti és új képbyte SenseNetben marad. A meglévő app-journal a kéréskötést és nyugtákat tárolja, a generált képbyte-okat nem. A korábbi eredetifeltöltés és ZIP-transzfer mechanikája változatlan.

## Szerkesztői folyamat

1. Timeline: **Edit Timeline → List cover**, legfeljebb négy kép kijelölése és rendezése, vagy **Random selection**.
2. **Generate preview**: a böngésző letölti az engedélyezett eredetiket, ellenőrzi/dekódolja őket, elkészíti a méreteket és a források SHA-256 hash-ét.
3. **Publish**: standard Folder/File létrehozás és Upload, visszaolvasás/byte-hash ellenőrzés, alkalmazási lezárás, majd az aktív készlet kiválasztása. Nincs natív SenseNet seal vagy aktiváló művelet.
4. A listakártya egy, a tényleges helyszélességhez és legfeljebb kétszeres DPR-hez illő képet kér. A fetch csak a viewport közelében indul; egyszerre legfeljebb kettő futhat.

Médiánál **Image sizes → Prepare sizes → Publish**. URL-only tartalomnál először **Upload original**; ez a kiválasztott fájlt átméretezés és újrakódolás nélkül menti. A régi, általános `application/octet-stream` MIME-os PNG/JPEG/WebP eredetik támogatottak tényleges formátumellenőrzéssel.

A **Use original presentation** visszavált az eredeti megjelenésre. A **Delete unused copies** külön megerősítéssel csak az inaktív generációkat törli. Az eredetiket egyik művelet sem cseréli le.

Ha a publikálás kimenetele bizonytalan, a panel megtartja az adott generációt, előnézetet és kéréskulcsokat. Amíg ez a függő publikálás megvan, a képválasztás, sorrend és Random módosítása szünetel; a **Retry publication** ugyanazt a generációt és ugyanazokat a kulcsokat folytatja. Elveszett válasz vagy időtúllépés miatt ne készíts helyette új képet, és ne használd az oldalfrissítést helyreállításként. A helyi Functions-időtúllépés külön felismerhető hibaüzenetet kap, nem általános gateway-elutasításként jelenik meg.

A képművelet előtti gateway-/jogosultsági előellenőrzés hibája nem tart meg függő publikálást, ezért ilyenkor a kijelölés szerkeszthető marad. Sikeres publikálás után is újra szerkeszthető a panel: módosítsd a kijelölést vagy sorrendet, készíts új **Generate preview** előnézetet, majd publikáld azt.

## Jogosultságok és adatmegőrzés

A képmappa és fájljai az őket tartalmazó elem standard SenseNet-jogosultságait öröklik. Minden művelet az aktuális felhasználó hitelesítésével fut; nincs admin vagy inventory identitással végzett képbyte-olvasás és nincs új jogosultság kiosztása. A mentéshez tényleges Save/AddNew, a takarításhoz Delete kell. A standard Upload saját AddNew-ellenőrzése is érvényes.

A publikált borító **önálló, statikus másolat**, a tartalmazó elem tényleges SenseNet-hozzáférési jogaival. Egy alkalmazási láthatósági jelző önmagában nem helyettesíti ezeket a jogokat. Nyilvános publikáláskor a kiválasztott forrásoknak is nyilvánosan olvashatónak kell lenniük. Egy forrás későbbi szerkesztése vagy priváttá tétele nem szerkeszti át automatikusan a már publikált másolatot; változó grafikához új előnézet/publikálás kell. Az owner olvasási jogának elvesztése a képet is elrejti.

Az alkalmazás saját API-ja védi a teljes készletre váltást, a név/owner/projekt-kötést, a méret-/MIME-/hash-korlátokat és a megismételt kéréseket. A standard fájlokat megfelelő jogosultsággal más SenseNet-kliens is szerkesztheti. Nincs natív módosíthatatlansági vagy több tartalomra kiterjedő atomikus CAS-ígéret. A gateway a saját íróit koordinálja; külső szerkesztőkkel szemben friss ellenőrzést és visszaolvasást használ.

Bizonytalan mentésnél ugyanaz a kéréskulcs ellenőrzi a korábbi eredményt. Nem indítunk új generációt pusztán elveszett válasz miatt. A helyreállítás meglévő app-journal/recovery folyamata nem ismétel vakon natív írást.

Ha az író már foglalt, de a megszakadás miatt még journal-bejegyzése sincs, a helyreállítás kizárólag metaadatot egyeztet az eredeti szereplőhöz, kéréskulcshoz és műveletazonosítóhoz kötve. Az operátornak előbb igazolnia kell a pontos eredeti kérés futtatójának tényleges leállását; eltelt idő vagy egy timeout önmagában nem ilyen bizonyíték. Ez az ág nem küld új SenseNet-írást és nem játssza újra a feltöltést.

## Helyi indítás és kézi próba

```powershell
& deployment/scripts/m0-runtime.ps1 start
docker compose -f compose.local.yaml up -d --build
```

App: **https://localhost:8080**, profil `m0-local`, repository `https://localhost:41016`. A teljes app a `timeline-local` / `app` Docker-konténerben fut; újraindítás: `docker compose -f compose.local.yaml restart app`. A beállításokat a gyökér ignored `.env` adja, az egyszer másolandó `.env.example` kizárólag a projekt saját localhost mintáját tartalmazza. Részletek: [helyi Docker-indítás](local-docker.md). A meglévő helyi accountok az ignored `deployment/.local/accounts.json` fájlban vannak; új account vagy éles belépés nem kell.

A megtartott, valódi poszteres helyi példa: [Local Conan demo](https://localhost:8080/timelines/local-conan-demo-833b49e7-0cf7-4359-8c4a-cdc84ba967e0). A timeline `9146`, három bejegyzése a meglévő `3007/3009/3011` médiákra hivatkozik. Alatta `(images)` SystemFolder `10102`, változatlan aktív generáció Folder `9151`, három standard File `9152–9154` található. A felhasználó későbbi, félbemaradt `10071` készlete és `10072` fájlja is megmaradt. Az átállítás képmásolás helyett standard Move: a generáció-/fájlazonosítók, manifestek, aktív kiválasztás, eredeti és generált SHA-k változatlanok; rekordszám `3009 → 3009`. Alapértelmezett lekérdezés a képrészfára `0`, `.AUTOFILTERS:OFF` mellett `7` találat. Aktuális bizonyíték: ignored `deployment/.local/system-image-storage-2026-11-06/migration-acceptance.json`; a korábbi demó-előnézet `deployment/.local/image-variants-demo-preview.png`.

Kézi próba:

1. Nyisd meg a demót, majd szerkesztőként **List cover**: a mentett három kép és sorrend látszik.
2. Készíts új előnézetet, publikáld, majd látogatóként ellenőrizd a listakártyát asztali és mobilnézetben. Network: egy generált kép, eredeti poszterek/entry-pool lekérése nélkül.
3. Egy saját tesztmédián **Image sizes → Prepare sizes → Publish**, majd lista és részletnézet: a kisebb, illetve nagyobb szükséges méret töltődjön.
4. **Use original presentation**, majd **Delete unused copies**: csak inaktív másolatok tűnjenek el. Az eredeti SHA, a timeline sorrendje és az ismételt média-előfordulások maradjanak meg.

## Ellenőrzés és kiadás

Sikeres friss ellenőrzések:

- 281 unit/contract teszt, 66 parity-ellenőrzés, lint és TypeScript/production build.
- Valódi Canvas-dekódolás/generálás: négy összeállítás, 12 kimenet.
- Standard HTTPS API: Timeline/MediaItem/BookMediaItem alatti Folder/File, eredetifeltöltés, lezárás, aktiválás és törlés; elveszett válasz helyreállítása ugyanazzal a kulccsal, natív írás megismétlése nélkül.
- 19/19 friss valós editor/Visitor ellenőrzés: 1–4 poszter, WebP/PNG, sorrend/Random, helyreállítás, médiaméretek/picker, inaktív takarítás, mobil, lusta betöltés, tényleges owner ACL-visszavonás és változatlan eredeti byte-ok. A teszt saját tartalmait kitakarította, 2998→2998 rekord.
- A Conan-példa valódi látogatói kártyája 400×200-as, 16 844 byte-os WebP-t töltött le: egy kérés, nulla eredeti/entry-pool kérés asztali és mobilnézetben is. Ez konkrét helyi minta, nem általánosított sebességígéret.
- A korábbi képbővítés helyi eltávolítása után 133 meglévő backendregresszió és a 2998 eredeti rekord/1503 eredeti binary megőrzési ellenőrzése sikeres. A SenseNet runtime/contenttype/extension/provisioning fájlok a develophoz képest változatlanok; az új `deployment/docker` kizárólag a kliens/app helyi konténerét írja le.

A publikálási regresszió vizsgálata és a javítás célzott bizonyítékai: ignored `deployment/.local/image-editor-regression-2026-11-06/`. A friss kódellenőrzések és a valódi editorból indított két-két egymást követő timeline-/médiapublikálás sikeres. Az első mentés után ténylegesen módosítható volt a kiválasztás, a második után is használható maradt a generáló gomb; mindkét owner két lezárt készletét külön standard API-val is ellenőriztük. Eredeti SHA-k változatlanok; saját teszttartalmak kitakarítva, 3009→3009 rekord. A **Publish** új előnézet készítéséig szürke marad: sikeres mentés után a kiválasztás és a **Generate preview / Prepare sizes** használható újra.

Megismételhető kódellenőrzés:

```powershell
npm test
npm run test:parity
npm run lint
npm run build
```

A futó helyi app és a meglévő Playwright/Chromium mellett: `node tests/image-client-browser.mjs`, majd `node scripts/m0-image-ui-smoke.cjs`. Az utóbbi kizárólag saját helyi UUID-tartalmakat készít és takarít; bizonytalan írásnál megőrzi a bizonyítékot, az ugyanott mentett `report.json` adható át a `--resume <absolute-path>` kapcsolóval. A Playwright/csomag és Chromium útvonala a `M0_PLAYWRIGHT_MODULE_PATH` és `M0_CHROMIUM_EXECUTABLE_PATH` környezeti változókkal állítható, új termékfüggőség nincs. A részletes helyi logok a `deployment/.local/image-variants-client-only-2026-11-06`, az editorproba a `deployment/.local/image-ui-smoke/8b877c95-cb52-4aa2-98e4-c540fcbefc0e` alatt vannak.

A Git/Netlify kiadás az alkalmazás kódját adja ki; SenseNet-bővítményt nem kell hozzá telepíteni. Meglévő tartalmak nem generálódnak át automatikusan. Első körben egy kis tartalmi mintát érdemes elkészíteni a saját szerkesztőben, majd a valódi látogatói megjelenést ellenőrizni. Ebben a munkában production tartalom-, séma-, ACL- vagy konfigurációírás nem történik; Joe merge-el és publikál.
