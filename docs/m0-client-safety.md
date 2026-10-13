# M0 kliens: környezet, céljogok és ellenőrzés

Az M0 fejlesztési alapértelmezése a külön helyi SenseNet. Az éles rendszerből csak a konfigurált MCP olvasó exportja készít snapshotot; a production login és ACL javítása külön feladat. Merge, automerge és deploy nincs ebben a változtatásban.

## Indítás és profil

A teljes backend, tanúsítvány, tesztidentitás és adatátvétel lépései: [m0-local-data.md](m0-local-data.md). Ezután a gyökérből:

```powershell
npm ci --prefix client
npm run dev
```

Nyisd meg a `https://localhost:8080` címet. A zöld sávban `local`, `Local writes enabled`, repository `https://localhost:41016`, auth `https://localhost:41017` jelenik meg. A helyi accountokat a bootstrap hozza létre; a jelszavak az ignored `deployment/.local/accounts.json` fájlban vannak, nem a bundle-ben.

Az explicit profilok:

| Parancs | Nyilvános profil | Írás |
| --- | --- | --- |
| `npm run dev` / `npm run build` | `client/profiles/local.json` + ignored `local.override.json` | Csak loopback helyi repository |
| `npm run dev:readonly --prefix client` / `npm run build:readonly --prefix client` | `production-readonly.json` + opcionális ignored override | Minden kliens repository-írás tiltott |

A Vite CLI mód neve `development-local`, mert a Vite a `local` módnevet fenntartja saját env-suffixére. A megjelenített belső mód `local`. A korábbi `.env`, `.env.local`, `.env.prod`, `.env.itteni`, `.env.miez` fájlok megmaradnak, de a kliens célválasztásában nem vesznek részt. A folyamatban beállított `TIMELINE_REPOSITORY_URL` és `TIMELINE_AUTHORITY` explicit publikus override, ugyanazon validáción megy át. Profilváltoztatás után állítsd le és indítsd újra a Vite folyamatot; a buildet újra kell készíteni.

Csak HTTPS origin, támogatott auth típus, érvényes project path, publikus SPA client ID és szigorú boolean writable fogadható el. A helyi mód cloud repository/auth párost elutasít; a remote mód writable=true értéket elutasít. Ismeretlen profilmező, URL-credential és path traversal is hibát ad. A Vite `VITE_*` örökölt env-befecskendezése nincs engedélyezve. Tanúsítvány nélküli dev startup hibával leáll.

Az SNAuth SDK három rögzített localStorage kulcsa még a provider mountja előtt repo/auth/client-ID szerinti névtérbe kerül. A native Storage getItem/setItem/removeItem adapter csak e három kulcsot és az adott ablak localStorage objektumát érinti; a többi kulcs és sessionStorage változatlan. Egy másik profil régi tabjának késői callback/refresh írása a saját névterében marad. Az ismeretlen eredetű legacy tokeneket nem migráljuk. Ugyanazon profil munkamenete reload után megmarad; futó ablakon belüli profilcsere teljes reloadot követel. Két valódi Chromium tab és újranyitás igazolta az elkülönítést, de az éles SNAuth login működését ez nem igazolja.

Az éles readonly auth-cél a meglévő konfiguráció publikus `https://plastice-is.sensenet.cloud` értékét rögzíti. Ez konfigurációs érték, nem a production login működésének igazolása. Az éles frontend nem volt megnyitva. A production anoním privát GET-résének szerveroldali javítása továbbra is külön, jóváhagyott feladat.

## Műveleti határ

Nincs importkor vagy oldalbetöltéskor futó `setupMediaLibrary`. Az alkalmazás read/404/401/403/TLS/network/server hibára nem hoz létre tartalmat. Provisioning kizárólag a helyi bootstrap/provision parancsban történik.

A közös facade minden konkrét célon ellenőriz: olvasás Open, létrehozás a szülőn AddNew és megengedett tartalomtípus, módosítás Save, törlés Delete, borítófeltöltés a médiaelemen Save. A bejelentkezés, email, csoportnév és AllowedChildTypes önmagában nem írhat felül tiltást. Ismeretlen eredmény vagy permission hiba tiltás.

A route és UI ellenőrzések elrejtik a tiltott műveleteket. A handler teljes céltervet ellenőriz az első írás előtt; a szolgáltatás és a végső transport újra ellenőriz. Logout/identitás/repository/revision változás megszakítja a függő műveletet. A már betöltött entry- és médiakártyák saját Open jogot is vizsgálnak: focus és legfeljebb 30 másodperces poll után a visszavont cél adatai/képe eltűnik. A többcélú műveletek az első hibánál megállnak. Egy valódi, közben bekövetkező backend hiba nem teszi tranzakcióvá a több lépésből álló importot; korábbi sikeres lépés ilyenkor megmaradhat. Ismert kezdeti jogosultsági tiltásnál egyetlen írás sem indul.

Az entry Save és a közös MediaItem Save/cover upload külön céljog. Reorder minden érintett entryt előre ellenőriz. A ZIP import előre beolvassa/validálja az összes sort, médiareferenciát és borítót; nem kezel lookup hibát új mű létrehozásaként. Új előfordulások külön neveket kapnak, cím szerinti deduplikáció nincs. A projektadatok teljes mentése a snapshot formátum, nem a termék ZIP exportja.

Az egyértékű Choice mezők (MediaType, Genre, EntryLabel, Importance) backend tömbreprezentációja olvasáskor kerül alakításra; több érték egy egyértékű mezőben hibát ad, nem csendes adatvesztést. Az önálló médiaszerkesztés csak megváltozott mezőket küld: egy cím szerkesztése nem remappeli a korábbi Choice aliasokat, nem írja újra az évszámot/dátumot és megőrzi a Rating=0 értéket.

A nyers Request objektum, unchecked POST/action/move/copy és cross-repository fetch tiltott. A kérésadatokról az első await előtt másolat készül, így későbbi GET→POST vagy FormData módosítás nem változtathatja meg a vizsgált kérést. A bináris feltöltés cél-ID/path/name/type/field és teljes multipart metaadata egyezni köteles. Külső borítók nem kapnak repository Bearer tokent. Az identitásváltás újramountolja az olvasó oldalakat és eldobja a korábbi privát adatokat/képeredményeket.

Visitor esetén a helyi official backend HasPermission 403-at ad, mert az Everyone szerepbe nem tartozik bele. Csak helyi anonim Open ellenőrzéshez történik minimális, konkrét `$select=Id` GET; minden hibát tiltásként kezel. Ez nem létrehozási vagy autentikációs fallback. A backend ACL a kliens megkerülésekor is érvényesül.

## Ellenőrző parancsok

```powershell
npm test
npm run lint
npm run build
npm run build:readonly --prefix client
npm run test:backend
npm run test:privacy
npm run test:reference
npm run test:browser
npm run test:auth-storage
```

A unit/snapshot tesztek backend nélkül futnak. A backend és böngészős tesztekhez a felállított runtime, helyi accountok, befejezett restore és futó HTTPS frontend szükséges. A böngészős futtató külön Chromium contextet használ, nem a személyes böngésző sessiont; HTTPS hibát nem kerül meg. Részletes eredménye és képei ignored `deployment/.local/browser-smoke/` alatt maradnak. A Playwright modul a Codex bundled runtime-ból vagy explicit `M0_PLAYWRIGHT_MODULE_PATH` útvonalról tölthető be; a helper a pontos használatot rögzíti.

A végső helyi böngészős futás `2026-10-13T17:43:01.324Z` időponttal 32/32 ellenőrzést teljesített (`passed: true`). Jelentés: `deployment/.local/browser-smoke/0abbc0d4-220e-4eb4-8f87-61d41ffe85c8/report.json`; ugyanott visitor, reader, editor CRUD és logout utáni PNG-k. A valódi OIDC reader/editor belépés, CRUD/rendezés/feltöltés/ZIP, teljes vegyesjogú preflight, módosított ZIP-előnézet elleni védelem, konkrét Open-megvonás utáni cache-törlés, referencia ACL és logout/Delete átment. A kibontott olvasható entry védett médiareferenciája HTTP 200 mellett üres volt; a permission endpoint natív HTTP 400 tiltását csak pontos exception/policy üzenettel és admin ACL-bizonyítékkal fogadta el a teszt. A Visitor és reader repository írásainak száma 0; a 9 UUID-fixture takarítása hibamentes, a projekt darabszáma 2998 maradt. Az öt startup GET hibainjektálási eset külön címkézett bizonyíték, a valódi backend-ellenőrzéseket nem helyettesíti.

CI-ben a contract tesztek, lint, mindkét kliensbuild és a helyi .NET 8 security extension fordítása fut. A Docker/valódi OIDC/backend/böngészős bizonyíték helyi integrációs futás; a CI nem helyettesíti.

## Dependency állapot

A kliens kezdeti npm auditja 37 jelzést adott (24 high). A DOMPurify 3.4.17, React Router 6.30.6, Vite 7.3.7 és az engedélyezett tartományokon belüli patch-frissítések után 10 maradt (3 high, 7 moderate, 0 critical). A fennmaradó high lánc az oidc-client → serialize-javascript függőség; további jelzések SenseNet/uuid, Quill és Router. Az audit által ajánlott SDK-downgrade vagy keretrendszer-főverzióváltás nem része az M0-nak. Nincs `audit fix --force`. A legacy root manifest nem a Vite alkalmazás telepítési útja; kliens telepítéshez `npm ci --prefix client` kell.

## Kézi smoke Joe számára

1. Indítsd a helyi runtime-ot és `npm run dev`-et. Ellenőrizd a zöld sáv minden célját. Visitor: nyilvános listák olvashatók, `Create` és média/entry író művelet nincs; közvetlen `/create`, `/media-library/create` és egy timeline `/add-entry` útvonala tiltott.
2. `Login with IdentityServer`: a formba a `M0Reader` LoginName-et írd, nem emailcímet. A jelszó az ignored accounts.json fájlban található. Belépés után maradjanak tiltottak az író műveletek. Privát timeline közvetlen URL-je ne adjon címet, leírást vagy entryt.
3. M0Editorral a `Create Timeline` gombbal (`/create`) hozz létre saját teszt-timeline-t. Az új elem alapból privát: ugyanaz a `/timelines/<Name>` cím külön Visitor/Reader sessionben ne adjon tartalmat. `Add Timeline Entry` → `Create New Media` → `Create Media Item` → `Add to Timeline`: hozz létre külön teszt-médiát, majd `Select` → `Add to Timeline` útvonalon add hozzá még egyszer. Maradjon két előfordulás. `Edit Entry` alatt az egyik Notes mezőjét mentsd `Save Changes` gombbal; a másik ne változzon.
4. `Reorder Entries` → `Save New Order` után töltsd újra az oldalt; az új sorrend maradjon. `Media Item Data` alatt teszt-borítófeltöltés és `Save Changes` után újratöltve is jelenjen meg a kép. `Export Timeline` majd `Import Timeline` ugyanabba a saját célba: a két occurrence ID maradjon külön. A ZIP import csak a kiválasztott, előre engedélyezett célokat érintse.
5. Privát adat megnyitása után `Logout`: korábbi privát szöveg/kép ne maradjon a felületen. Reader/Visitor alatt ne legyen további írás. Editorral a saját fixture egyik `Delete Entry`, majd `Delete Timeline` műveletét próbáld; a külön teszt-médiát is töröld a Media Libraryból. Az átvett source adatot hagyd érintetlenül.
6. `m0-runtime.ps1 -Action stop`, majd `-Action start`, és ismételd az olvasást. Ez megőrzi az SQL/repository/auth volume-okat és a meglévő tanúsítványokat. A dev folyamat külön folyamat; profilváltásnál azt is külön indítsd újra.

A kézi lépések nem írnak productionbe. A tényleges végső integrációs eredményeket és esetleges korlátokat a PR/handoff rögzíti.
