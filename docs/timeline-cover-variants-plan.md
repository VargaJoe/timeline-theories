# Generált timeline-borítók és képváltozatok

Döntés frissítve: 2026-11-06. Ág: `feature/sensenet-image-variants`, PR #62, alap `develop` / `8813d6fa`. A standard kliens/app megvalósítás és a friss helyi API/editor/Visitor elfogadás kész; a kiadást Joe végzi.

## Rögzített irány

Joe kifejezett utasítása: **nem bővítjük a SenseNetet; a kliensalkalmazásban kell megoldani.** A korábbi szerveroldali bővítményes tervet ez felülírja. Nincs új DLL, content handler, observer, natív képművelet, dekóder, tartalomtípus vagy mező. A korábbi terv Git-változata [8296b618](https://github.com/VargaJoe/timeline-theories/blob/8296b61875ef7fea4f1040590773e7c6099cf16d/docs/timeline-cover-variants-plan.md) alatt marad történeti anyagként.

Minden eredeti és generált kép a SenseNetben legyen. A meglévő app-journal/koordináció maradhat; új Blobs-képtár nem készül. A mentett `poster-strip-v1` kép legfeljebb négy, egymást nem fedő posztert tartalmaz. A 2026-11-07-i megjelenítési lépés ugyanebből az egy fájlból készít elforgatott, átfedő kártyalegyezőt és külön hover-kiemelést; nincs újragenerálás vagy hover-letöltés. Az összes timeline-elem egérrel pörgethető nézete későbbi feladat. [Megjelenítési szerződés](timeline-cover-card-presentation.md).

## Egyszerű tárolási modell

| Feladat | Alkalmazási megoldás |
| --- | --- |
| Előkészítés | Böngészős Canvas, tényleges eredeti-SHA, WebP és PNG-fallback |
| Tárolás | Az owner alatti standard `_images` Folder és generációnként Folder/File |
| Metaadat | Az új mappák meglévő Description mezőjében korlátozott JSON |
| Publikálás | A teljes készlet ellenőrzése után a gyökérmappa aktív-generáció adatának mentése |
| Méretválasztás | Helyszélesség × legfeljebb DPR2, viewport előtti fetch-korláttal |
| Eredeti megőrzése | CoverImageBin/CoverImageUrl változatlan |
| Takarítás | Csak az inaktív, pontosan azonosított generációk explicit törlése |

Az adott owner meglévő AllowedChildTypes beállításához az app hozzáadja a standard Folder/File gyermekeket, a korábbi típusok megtartásával. Nincs globális CTD- vagy ACL-módosítás. Normál editorral, saját helyi fixture-ökön a Timeline, MediaItem és BookMediaItem alatti tárolás standard API-próbája sikeres volt; minden próba kitakarított. A képbővítmény nélküli környezetben 256 unit/contract, 58 parity, lint/build, valódi Canvas és 19/19 friss editor/Visitor ellenőrzés sikeres. A meglévő posztereket használó, kilenc rekordos Conan-demó külön megtartott helyi példa.

Az ownerhez kapcsolódó tárhely együtt mozog az elemmel és örökli annak tényleges SenseNet-jogosultságait. A mappa nem timeline-előfordulás: a listázás/sorrend kizárólag a közvetlen TimelineEntry gyermekekkel dolgozik. A teljes törlés minden tényleges leszármazott jogosultságát figyelembe veszi.

## Jogosultsági és konzisztenciahatár

A publikált borító statikus tartalom, a tulajdonos elem tényleges SenseNet-hozzáférési jogaival. Nyilvános publikáláshoz a forrásoknak is nyilvánosan olvashatónak kell lenniük. A forrás későbbi változása nem vonja vissza automatikusan a korábban publikált másolatot. Ez nem a korábbi, natív összesforrás-jogmetszet modell.

Minden olvasás/írás az aktuális callerrel történik. Nincs admin/inventory byte-reader, új jogosultság vagy titkos tárolási szolgáltatás. A Save/AddNew/Delete és a standard Upload ellenőrzése megmarad. Egy alkalmazási láthatósági jelző nem helyettesíti a tényleges SenseNet ACL-t.

A gateway a saját íróit és nyugtáit koordinálja. A standard fájlok külső SenseNet-kliensből is szerkeszthetők; nincs natív módosíthatatlansági vagy több tartalomra kiterjedő CAS-ígéret. A források hash-ét a szerkesztő és a publikálás ellenőrzi, nem minden látogatói listabetöltés.

## Befejezési feltételek

- A PR új SenseNet-kód/deployment/CTD diffje legyen üres a develophoz képest.
- A régi képtípusok, műveletek és hookok ne legyenek jelen a helyi futó backendben; az eredeti adatok/byte-ok változatlanok maradjanak.
- Standard File/Folder adapter, journal/recovery, eredetifeltöltés, csere/visszaállítás és inaktív takarítás működjön valódi API-val.
- Valódi editor/Visitor desktop és mobil próba, megfelelő képméret, tényleges dekódolás, owner ACL-visszavonás és változatlan eredeti-hash szükséges.
- A látogató generált kártyához egy megfelelő képet töltsön le, eredeti poszterek és entry-pool nélkül; legacy tartalom regresszió nélkül maradjon használható.
- A teljes teszt/parity/lint/build kör, a végső Git preview és a dokumentáció/Obsidian átadás készüljön el. Joe merge-el és publikál; production írás nincs ebben a körben.

Használat és tárolási fa: [útmutató](image-variants-usage-and-rollout.md). A korábbi proof státusza: [történeti M0-jelentés](image-variants-m0-verification.md).
