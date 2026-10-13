# M0 kliens: környezet, céljogok és ellenőrzés

Az alkalmazás repository/auth célját a felhasználó `.env`/hosting konfigurációja határozza meg. Az elkülönített M0 runtime külön, explicit tesztparanccsal választható. Az agent production vizsgálata csak olvasó; production ACL írás, merge, automerge és kézi deploy nincs ebben a változtatásban.

## Indítás és profil

A teljes backend, tanúsítvány, tesztidentitás és adatátvétel lépései: [m0-local-data.md](m0-local-data.md). Ezután a gyökérből:

```powershell
npm ci --prefix client
npm run dev:m0
```

Nyisd meg a `https://localhost:8080` címet. A fejlesztői sávban `m0-local`, `Writes enabled`, repository `https://localhost:41016`, auth `https://localhost:41017` jelenik meg. A sáv kizárólag Vite dev alatt látszik; Netlify és minden buildelt felület elhagyja. A helyi accountokat a bootstrap hozza létre; a jelszavak az ignored `deployment/.local/accounts.json` fájlban vannak, nem a bundle-ben.

Az explicit profilok:

| Parancs | Nyilvános profil | Írás |
| --- | --- | --- |
| `npm run dev` / `npm run build` | Standard Vite `.env` / hosting `VITE_*` | Konkrét céljogok alapján, local és remote repo egyaránt |
| `npm run dev:readonly --prefix client` / `npm run build:readonly --prefix client` | Ugyanez a felhasználói env; a cél nem változik | Minden kliens repository-írás tiltott |
| `npm run dev:m0` / `npm run build:m0 --prefix client` | `client/profiles/local.json` + ignored `local.override.json` | Elkülönített loopback M0 tesztrepo |

A normál Vite prioritás alacsonytól magasig: `.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local`, végül a folyamat/Netlify környezeti változói. `dev` módja `development`, `build` módja `production`; egyéb env fájlhoz a megfelelő `--mode` kell. A `VITE_SENSENET_REPO_URL`, `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_PROJECT_ROOT_PATH` változókat a kliens nem cseréli localhostra vagy másik repóra. Lokális frontend production repohoz is kapcsolható. `VITE_AUTH_TYPE=auto` (default) a konfigurált repo publikus discovery válaszából csak az auth provider típusát választja ki; az authority/client ID envből marad. `VITE_READ_ONLY=true` explicit tilt minden appírást. Env-változás után restart/build kell; a felhasználó env fájljait a bootstrap sem írja felül.

Csak HTTPS origin, támogatott auth típus, érvényes project path, publikus SPA client ID és szigorú boolean writable fogadható el. Loopback-korlát kizárólag az explicit `m0-local` tesztprofilban van. A browser env publikus mezők allowlistje: az URL/client ID/UI beállítások bekerülhetnek; tetszőleges `VITE_*` mező, API key, token, jelszó nem. URL-credential és path traversal hibát ad. Tanúsítvány nélküli dev startup hibával leáll.

Az SNAuth SDK három rögzített localStorage kulcsa még a provider mountja előtt repo/auth/client-ID szerinti névtérbe kerül. A native Storage getItem/setItem/removeItem adapter csak e három kulcsot és az adott ablak localStorage objektumát érinti; a többi kulcs és sessionStorage változatlan. Egy másik profil régi tabjának késői callback/refresh írása a saját névterében marad. Az ismeretlen eredetű legacy tokeneket nem migráljuk. Ugyanazon profil munkamenete reload után megmarad; futó ablakon belüli profilcsere teljes reloadot követel. Két valódi Chromium tab és újranyitás igazolta az elkülönítést, de az éles SNAuth login működését ez nem igazolja.

Az éles auth-cél az envben konfigurált érték; nincs rögzített remote JSON célprofil. A PR-preview Visitor olvasása ellenőrizhető production írás nélkül. Production admin login/írás és a korábbi audit szerveroldali ACL-megállapításai külön szelet; az éles ACL nem változik.

## Műveleti határ

Nincs importkor vagy oldalbetöltéskor futó `setupMediaLibrary`. Az alkalmazás read/404/401/403/TLS/network/server hibára nem hoz létre tartalmat. Provisioning kizárólag a helyi bootstrap/provision parancsban történik.

A közös facade minden konkrét célon ellenőriz: olvasás Open, létrehozás a szülőn AddNew és megengedett tartalomtípus, módosítás Save, törlés Delete, borítófeltöltés a médiaelemen Save. A bejelentkezés, email, csoportnév és AllowedChildTypes önmagában nem írhat felül tiltást. Ismeretlen eredmény vagy permission hiba tiltás.

A route és UI ellenőrzések elrejtik a tiltott műveleteket. A handler teljes céltervet ellenőriz az első írás előtt; a szolgáltatás és a végső transport újra ellenőriz. Logout/identitás/repository/revision változás megszakítja a függő műveletet. A már betöltött entry- és médiakártyák saját Open jogot is vizsgálnak: focus és legfeljebb 30 másodperces poll után a visszavont cél adatai/képe eltűnik. A többcélú műveletek az első hibánál megállnak. Egy valódi, közben bekövetkező backend hiba nem teszi tranzakcióvá a több lépésből álló importot; korábbi sikeres lépés ilyenkor megmaradhat. Ismert kezdeti jogosultsági tiltásnál egyetlen írás sem indul.

Az entry Save és a közös MediaItem Save/cover upload külön céljog. Reorder minden érintett entryt előre ellenőriz. A ZIP import előre beolvassa/validálja az összes sort, médiareferenciát és borítót; nem kezel lookup hibát új mű létrehozásaként. Új előfordulások külön neveket kapnak, cím szerinti deduplikáció nincs. A projektadatok teljes mentése a snapshot formátum, nem a termék ZIP exportja.

Az egyértékű Choice mezők (MediaType, Genre, EntryLabel, Importance) backend tömbreprezentációja olvasáskor kerül alakításra; több érték egy egyértékű mezőben hibát ad, nem csendes adatvesztést. Az önálló médiaszerkesztés csak megváltozott mezőket küld: egy cím szerkesztése nem remappeli a korábbi Choice aliasokat, nem írja újra az évszámot/dátumot és megőrzi a Rating=0 értéket.

A nyers Request objektum, unchecked POST/action/move/copy és cross-repository fetch tiltott. A kérésadatokról az első await előtt másolat készül, így későbbi GET→POST vagy FormData módosítás nem változtathatja meg a vizsgált kérést. A bináris feltöltés cél-ID/path/name/type/field és teljes multipart metaadata egyezni köteles. Külső borítók nem kapnak repository Bearer tokent. Az identitásváltás újramountolja az olvasó oldalakat és eldobja a korábbi privát adatokat/képeredményeket.

Visitor esetén a local és a production backend `HasPermission` művelete egyaránt 403-at ad olvasható public médiára is. Anonim olvasásnál minimális, konkrét `$select=Id` GET bizonyítja a backend által engedett hozzáférést; minden hibát tiltásként kezel. Ez nem írási vagy autentikációs fallback; bejelentkezve továbbra is konkrét `HasPermission` kell. A Name-alapú média URL előbb csak Id/Name névfeloldást végez a MediaLibrary teljes fájában, majd külön, konkrét ID-jogellenőrzéssel tölti és figyeli a médiát. Az alkönyvtárak támogatottak, a numerikus Name nem keveredik ContentId-val. Nem egyértelmű névfeloldás zárt marad.

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

1. Indítsd a helyi runtime-ot és `npm run dev:m0`-t. Ellenőrizd a fejlesztői sáv minden célját. Visitor: nyilvános listák és az alkönyvtárban tárolt `Death Wish (1974)` média olvashatók; timeline-kártya és közvetlen média URL is működik. `Export Timeline`, `Import from Trakt List`, `Create` és média/entry író művelet nincs; közvetlen `/create`, `/media-library/create` és egy timeline `/add-entry` útvonala tiltott. Production buildben a diagnosztikai sáv nem jelenik meg.
2. `Login with IdentityServer`: a formba a `M0Reader` LoginName-et írd, nem emailcímet. A jelszó az ignored accounts.json fájlban található. Belépés után maradjanak tiltottak az író műveletek. Privát timeline közvetlen URL-je ne adjon címet, leírást vagy entryt.
3. M0Editorral a `Create Timeline` gombbal (`/create`) hozz létre saját teszt-timeline-t. Az új elem alapból privát: ugyanaz a `/timelines/<Name>` cím külön Visitor/Reader sessionben ne adjon tartalmat. `Add Timeline Entry` → `Create New Media` → `Create Media Item` → `Add to Timeline`: hozz létre külön teszt-médiát, majd `Select` → `Add to Timeline` útvonalon add hozzá még egyszer. Maradjon két előfordulás. `Edit Entry` alatt az egyik Notes mezőjét mentsd `Save Changes` gombbal; a másik ne változzon.
4. `Reorder Entries` → `Save New Order` után töltsd újra az oldalt; az új sorrend maradjon. `Media Item Data` alatt teszt-borítófeltöltés és `Save Changes` után újratöltve is jelenjen meg a kép. `Export Timeline` majd `Import Timeline` ugyanabba a saját célba: a két occurrence ID maradjon külön. A ZIP import csak a kiválasztott, előre engedélyezett célokat érintse.
5. Privát adat megnyitása után `Logout`: korábbi privát szöveg/kép ne maradjon a felületen. Reader/Visitor alatt ne legyen további írás. Editorral a saját fixture egyik `Delete Entry`, majd `Delete Timeline` műveletét próbáld; a külön teszt-médiát is töröld a Media Libraryból. Az átvett source adatot hagyd érintetlenül.
6. `m0-runtime.ps1 -Action stop`, majd `-Action start`, és ismételd az olvasást. Ez megőrzi az SQL/repository/auth volume-okat és a meglévő tanúsítványokat. A dev folyamat külön folyamat; profilváltásnál azt is külön indítsd újra.

A kézi lépések nem írnak productionbe. A tényleges végső integrációs eredményeket és esetleges korlátokat a PR/handoff rögzíti.
