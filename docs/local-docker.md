# Helyi app Docker Compose-ban

A helyi alkalmazást mindig a repository gyökerében található `compose.local.yaml` fájllal indítsd. A `timeline-local` projekt `app` konténere szolgálja ki a teljes HTTPS appot: UI, Netlify Functions/API, háttérmunkák és a meglévő tartós helyi app-journal. A Vite önmagában nem a teljes alkalmazás.

## Meglévő helyi környezet

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
docker compose -f compose.local.yaml up -d --build
docker compose -f compose.local.yaml ps
```

App: https://localhost:8080. A Docker Desktopban a **timeline-local → app** Start/Restart gombja is használható.

A helyi API és az OIDC-belépés engedélyezett app-originje is `https://localhost:8080`. Ha a listát a `https://127.0.0.1:8080` (vagy IPv6 loopback) címen nyitod meg, az app még a belépés és az adatlekérések indítása előtt a megfelelő localhost-címre vált; az útvonal, a szűrők és a hash megmaradnak. A közvetlen API-hívás eltérő originnel továbbra is 403-at kap. A production alkalmazás címét ez az átirányítás nem módosítja.

CLI-parancsok:

```powershell
docker compose -f compose.local.yaml restart app
docker compose -f compose.local.yaml logs --tail 100 -f app
docker compose -f compose.local.yaml stop app
```

Ugyanezek npm-rövidítései: `npm run local:up`, `local:restart`, `local:logs`, `local:stop`, `local:status`. A korábbi `npm run dev:m0` is Docker Compose-t indít, a gyökérből és a client könyvtárból egyaránt. Az image rögzített Node 22 alapról, lockfile-okkal buildel. Forráskód-változás után `up -d --build`; `.env`-változás után `up -d --force-recreate`. A `restart` a már létrehozott konténer környezetét használja. Az app induláskor nem másol tartalmat és nem provisionál SenseNetet.

A `restart: unless-stopped` miatt Docker-újraindítás után is elindul, ha előzőleg nem állítottad le kézzel. A healthcheck a valódi HTTPS API `capabilities` válaszát ellenőrzi, nem csupán a portot. Ez az app állapota; a külön SenseNet repositorynak is működnie kell a tartalmakhoz. A hoston csak a `127.0.0.1:8080` port publikus.

## Beállítások és Git-határ

- A tényleges konfiguráció a gyökér `.env` fájlból jut a konténerbe; a `.env` gitignored és a Docker buildből is kizárt. Meglévő `.env`-et nem írunk felül.
- A követett `.env.example` kizárólag a Timeline Theories saját `https://localhost:41016` repositoryját és `https://localhost:41017` IdentityServerét használja. Ezek a projekthez létrehozott helyi címek; nincs benne másik projekt egyedi repositoryja vagy titka.
- Saját/idegen repositoryhoz a **privát `.env`-ben** válassz `TIMELINE_DOCKER_PROFILE=development` vagy `production-readonly` módot, és add meg mindkét tényleges HTTPS origint, a publikus SPA client ID-t, auth típust és project pathot. A `production-readonly` mód a kliensben és API-ban is letiltja az írást. A célváltás a saját repository/auth CORS és callback beállításait is igényli; az app ezeket nem írja át.
- A böngészőbe kizárólag az alkalmazás meglévő publikus mező-allowlistje kerül. Jelszót, API-kulcsot, client secretet vagy tokent soha ne nevezz `VITE_*`-nak. A provider kulcsok opcionális, szerveroldali `.env`-értékek.
- Az M0 profil a pontos saját localhost célra korlátozott. Az üres `VITE_OIDC_CLIENT_ID` a meglévő bootstrap által létrehozott publikus `client/profiles/local.override.json` client ID-ját veszi át. Az env-be írt publikus beállításokból a konténer saját, átmeneti profilja készül, a host profilját nem írja át.

A Docker-image buildje nem tartalmaz `.env`-et, privát profil-override-ot, tanúsítványt, fiókot, inventory-kulcsot, app-journalt, adatbázist vagy backupot. Ezek csak futáskor, külön bind mountból érhetők el. A buildhez használt lokális Netlify-konfiguráció követett, és nem tartalmaz repository-specifikus vagy titkos értéket.

## Adatok, hálózat és első beállítás

A meglévő `timeline-m0` SQL/repository/identity Compose-projekt változatlan. Saját adatai és volume-jai nem az app-image részei. Az app readonly mountot kap a localhost tanúsítványokhoz, a publikus helyi profilhoz és a saját inventory-konfigurációhoz; a `deployment/.local/netlify-app-blobs` könyvtár a megőrzött, írható app-állapot. Az eredeti és generált képbyte-ok továbbra is SenseNetben vannak.

A böngésző és az OIDC callback címei localhost HTTPS címek maradnak. A konténer csak a szükséges saját loopback `41016/41017` portokon továbbít nyers TCP-t a `TIMELINE_DOCKER_HOST` felé (Docker Desktopon `host.docker.internal`). A TLS végponttól végpontig megmarad, a tanúsítvány-ellenőrzés nincs kikapcsolva. A két továbbítóport nincs publikálva a hostra. Távoli cél esetén nincs ilyen átirányítás.

A helyi Node-folyamatok `--dns-result-order=ipv4first` beállítással futnak: ez a Netlify CLI Function-streamet fogadó és hívó workerének localhost-címfeloldását egyezteti Linuxon. Nem TLS-kivétel és nem production változtatás.

A helyi Netlify CLI szinkron Functions-limitje 30 másodperc; az app helyi, 25 másodperces belső kerete a CLI kényszerleállítása előtt hagy időt a kezelhető hibára. A production időkerete ettől nem változik. Az ismert Lambda-időtúllépést a kliens felismeri és érthetően jelzi. Az átfedő readiness-ellenőrzések egy folyamatban lévő kérést osztanak meg; az adott cél jogosultsági ellenőrzése és az írás előtti friss backend-ellenőrzés megmarad.

A bizonytalan képpublikálás megőrzött előnézetét a **Retry publication** az eredeti generációval és kulcsokkal folytatja; ne próbáld oldalfrissítéssel vagy új kép indításával megkerülni. Hiányzó journal mellett is csak az eredeti szereplőhöz/kulcshoz/művelethez kötött metaadat-helyreállítás engedhető, a pontos eredeti kérés futtatójának igazolt leállítása után. A timeout vagy az eltelt idő nem elég; ez a helyreállítás nem ismétel SenseNet-írást. A szokásos restart/rebuild parancs önmagában nem old fel bizonytalan műveletet. A szerkesztői lépések: [képméretek és publikálás](image-variants-usage-and-rollout.md#szerkesztői-folyamat).

Már inicializált helyi repónál csak ellenőrizd/indítsd a meglévő backendet, majd az appot:

```powershell
./deployment/scripts/m0-runtime.ps1 -Action start
docker compose -f compose.local.yaml up -d --build
```

Friss checkoutnál egyszer szükséges Node.js 22.21+, PowerShell 7, Docker Desktop és kompatibilis .NET SDK a meglévő M0 inicializáláshoz:

```powershell
npm ci --legacy-peer-deps
npm ci --prefix client --legacy-peer-deps
./deployment/scripts/m0-bootstrap.ps1 -TrustCertificate
node scripts/m1-local-inventory-setup.cjs
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
docker compose -f compose.local.yaml up -d --build
```

A helyi adatpillanatkép és helyreállítás külön folyamat: [M0 helyi adatok](m0-local-data.md). Meglévő adatokkal nem kell újra bootstrapelni; nincs `down -v` vagy volume-törlés. A Docker Compose `.env` működése és az újraindítási házirend a [hivatalos Compose-konfigurációt](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/) és [Docker restart policyt](https://docs.docker.com/engine/containers/start-containers-automatically/) követi.

## Gyors kézi ellenőrzés

1. `ps`: az app healthy; https://localhost:8080 listák és Media Library működnek.
2. A megtartott [Conan-demo](https://localhost:8080/timelines/local-conan-demo-833b49e7-0cf7-4359-8c4a-cdc84ba967e0) listaborítója és az editor **List cover** panelje megnyílik.
3. `restart app` után a kép és a mentett kiválasztás továbbra is látható; a helyi app-állapot és a repository adatai megmaradnak.

2026-11-06, Windows/Docker Desktop: a végleges image buildje és healthcheckje sikeres. A teljes tesztkör 269/269; a 13 új launcher-teszt valódi bináris TCP-továbbítást, takarítást, környezeti célkötést és readonly-határt is ellenőriz. A hat valós böngészőpróba (API/cél, látogatói generált kártya, Media Library, OIDC-belépés, mentett editor-kiválasztás, mobil) az újraindítás előtt és után is sikeres, alkalmazás-/oldalhiba és tartalmi írás nélkül. A repository 3007→3007 rekord; az app 8436 fájljának / 165 732 829 byte-jának összesített SHA-256 lenyomata újralétrehozás és újraindítás után is egyezik. Az image-ben `.env`, privát profil, tanúsítvány, helyi adat és `.git` nincs; nem root felhasználóval fut. Részletes helyi bizonyíték: ignored `deployment/.local/local-compose-2026-11-06/`.

A későbbi publikálási regresszió javításának friss kódellenőrzése 281 unit/contract teszt, 66 parity-ellenőrzés, lint és build: sikeres. Valódi helyi editorral, ugyanazon megnyitott panelen a timeline és a média is kétszer egymás után publikálható volt. A kiválasztás/új előnézet mindkét mentés után használható, mindkét owner alatt két lezárt generáció igazolt; az eredeti SHA-k változatlanok. Saját teszttartalmak kitakarítva, 3009→3009 rekord. Az eredeti hibás kérés írózárát a pontos régi konténer igazolt megszűnése után, nulla SenseNet-írással oldottuk fel; a felhasználó félkész készlete és korábbi aktív borítója megmaradt. Bizonyíték: ignored `deployment/.local/image-editor-regression-2026-11-06/`.
