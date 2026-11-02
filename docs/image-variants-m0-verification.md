# SenseNet képváltozatok — az első, helyi backend-alap

Dátum: 2026-11-03. Ág: `feature/sensenet-image-variants`, alap: `develop` / `8813d6fa`.

Ez a [borítóterv](timeline-cover-variants-plan.md) első technikai részének megvalósítása: az eredetit megőrző, külön SenseNet-képtartalmak és egy aktiváló referencia működő helyi próbája. Az alkalmazás listái és szerkesztője még a meglévő borítófolyamatot használják. Production tartalom, séma, ACL, hosting vagy extension nem változott; képek nem kerülnek Netlify Blobsba.

## Tárolási szerződés

```text
/Root/Content/timelines/ImageAssets/<ownerId>/<generationUUID>/
  ImageVariantSet                OwnerContent, SourceContents, GenerationId,
                                 Manifest, Sealed
    w400                         ImageVariant, Binary: image/png
    w800                         ImageVariant, Binary: image/png

Timeline / MediaItem / BookMediaItem
  CoverImageBin / CoverImageUrl   megőrzött eredeti / legacy forrás
  CoverImageSet                  opcionális Reference az aktív készletre
```

- A set saját Folder-alapú típus, a fájl saját Image-alapú típus. A Timeline továbbra is TimelineEntry gyerekeket enged, a MediaItem nem válik Folderré.
- A kötés: aktuális projekt + owner-ID + generáció + legfeljebb négy médiaforrás. Owner, forráslista és generáció az első mentéstől kötött; másik választás új setet készít.
- Draftba kerülnek a fájlok. A lezárás ellenőrzi a tényleges teljes gyereklistát, PNG-rastert, MIME-ot, dimenziót, bytehosszt és SHA-256-ot. Csak lezárt, saját ownerhez tartozó set aktiválható.
- Egy `CoverImageSet` referencia cseréje aktiválja az egész készletet. A feltöltések több műveletből állnak; ez nem többfájlos tranzakció.
- A lezárt set/fájl nem módosítható, újranyitható vagy egyenként törölhető. Az inaktív teljes set törlése külön, tényleges owner Save + set/gyerek Delete preflighttal lehetséges. Aktív set és aktív referenciájú owner törlése tiltott.
- Ez a proof szándékosan **8 bites RGB/RGBA, nem interlaced PNG** kimenetre korlátozott, IHDR/IDAT/IEND chunkokkal. Korlát: 1–3 fájl, fájlonként 1 MiB, összesen 3 MiB; legfeljebb 4096 px tengelyenként és 4 Mi pixel. A manifest legfeljebb 16 KiB. WebP/JPEG és a böngészős generátor következő lépés.

## Hozzáférés és stock SenseNet sajátosságok

Az olvasás az **eredeti caller** saját Open/OpenMinor jogát ellenőrzi a képen, owneren és valamennyi forráson. Látogatónak csak az aktuális aktív set olvasható. A szerkesztő saját Save joggal és valamennyi forrás Open jogával draftot/korábbi setet is megnyithat. Régi verzió vagy elavult node-cache nem adhat régi byte-okat új jogosultsági állapot mellett. Nincs admin/inventory credential a képbyte-ok olvasásában.

A natív BinaryHandler kiterjesztéses útvonalnál a `304` választ a handler betöltése előtt is eldöntheti. Ezért a fájlok **kiterjesztés nélküli contentneve** (`w400`) kötelező; a formátumot a Binary MIME és manifest tartalmazza. A végső válasz `no-store`; a feltételes és `maxAge`-es letöltés is aktuális jogosultsági ellenőrzésen megy át. Az image-handler által elutasított natív képolvasás HTTP403-ra kerül; belső konfigurációs/manifest hiba nem minősül át jogosultsági válasszá. A globális `Portal.settings` változatlan.

A stock `SystemFolder`/`TrashBag` gyermek- és copy/trash/restore kivételek miatt a CTD AllowedChildTypes önmagában nem elég. Szűk asset-scope NodeObserver védi a teljes ágat és a tartalmazó ősök tömeges move/copy/delete útját. A scaffolding Save/Delete joga helyileg tiltott a szerkesztőnek; a set-műveletek szükséges jogai nem öröklődnek tiltásként a gyerekekre. A menedzsmentmappák látogatói metaadatai zártak, az aktív képek saját ellenőrzött joga külön működik.

A CoverImageSet indexelése nyers referencia-ID-t őriz: a forrás Open elvesztése nem törli a kapcsolatot, és nem akadályoz meg egy külön címmentést. A kép továbbra is hozzáférés-megtagadást ad.

## Reprodukció az izolált M0 környezetben

Feltétel: a már restore-olt helyi M0 adatok, tanúsítványok és saját accountok. Az [M0-adatkezelés](m0-local-data.md) meglévő megőrzési szabályai érvényesek. A parancsok a repó gyökeréből futnak:

```powershell
& deployment/scripts/m0-runtime.ps1 start
node scripts/m0-local-api.cjs
node scripts/m0-image-variants-provision.cjs
node scripts/m0-image-variants-smoke.cjs
```

A `start` szükséges a két új helyi env-flag első alkalmazásához; puszta `restart` nem frissíti a konténer konfigurációját. A volume-ok megmaradnak. Ugyanaz a read-only DLL kap explicit indítási regisztrációt:

- `DOTNET_STARTUP_HOOKS=/app/Timeline.Theories.M0.Security.dll`: dependency-free assembly preload a stock host előtt.
- `ASPNETCORE_HOSTINGSTARTUPASSEMBLIES=Timeline.Theories.M0.Security`: a scope observer és IHttpContextAccessor regisztrációja.

A kód regisztráció hiányában fail-closed; nem szerkeszt stock hostot vagy `deps.json`-t. A provision kizárólag a helper fix `https://localhost:41016` célján működik: felteszi a saját CTD-ket, a meglévő Workspace típuslistát az új két típussal bővíti, és létrehozza/védi az ImageAssets gyökeret. A proof owner-mappáit helyi admin készíti elő; a normál tesztírások és képbyte-olvasások valódi szerkesztő/reader/Visitor identitással történnek. Új account vagy credential nem készül.

Gyors létrehozási diagnosztika: `node scripts/m0-image-variants-smoke.cjs --probe-create`. Ez külön jelentést ír, és nem helyettesíti a teljes elfogadást.

## Ellenőrzési eredmény

A teljes natív próbában valódi névtelen Visitor és authorization-code PKCE reader/editor szerepel, ellenőrzött GetCurrentUser eredménnyel. Draft/inaktív/régi készlet, owner/source visszavonás, explicit verzió, If-Modified-Since/maxAge, teljes aktiválás, rossz hash/MIME/dimenzió/PNG, stock-child bypass, sealed overwrite/chunk-start/törlés, címmentés, referencia-rename és eredeti SHA ellenőrzés szerepel benne. A végleges futás összefoglalója a gitignored `deployment/.local/image-variants-smoke.json`.

**Végső eredmény: 42/42 natív ellenőrzés PASS**, 12 saját fixture törölve, rekord2999→2999. A hibás raster/CRC nem publikálható; a nyers és feltételes jogosulatlan binary kérés egyaránt HTTP403. Az owner-delete tiltás és a konkurens activation/inaktívset-delete próba is sikeres; pontosan egy művelet nyer, nincs aktív lógó referencia.

Meglévő M0 backend regressziók ugyanezzel a DLL-lel, egymás után futtatva: backend13, reference-privacy74, timeline-privacy46 ellenőrzés PASS (utóbbi1746 versenyminta). A reference-privacy futás után is rekord2999→2999. A konténer read-only DLL SHA-256-je egyezik a host builddel: `96a983681223ef51016897b217cb9d48e687a45925ed6171e9f78b17156fa65c`. Fordítás:0 warning,0 error.

A mérés **szintetikus, lossless PNG** fixture-t használ; nem production posztert vagy UI-t mér. Egy kiválasztott 400×200 változat 165 022 byte, a négy 640×960 eredeti összesen 3 192 273 byte. A végső három directBinary minta90,3/186,1/185,8 ms, medián185,8 ms. Korábbi azonos jellegű futások mediánja65,8 és124,4 ms volt; a környezeti szórás miatt ezekből nem következtetünk production gyorsulásra vagy P95-re. Ez a backend-út működésének és költségének kis mintája, nem végleges WebP-budget.

Az alkalmazás ellenőrzése: 201 unit/contract, 58 paritásellenőrzés, lint és production build PASS. A meglévő snapshot-konkurencia tesztben a független HTTP-kérések beérkezési sorrendjére tett instabil elvárást javítottuk; a négyes limitet, duplikátumokat és tényleges válaszsorrendet továbbra is ellenőrzi.

## Következő bekötés

A statikus Listaborító szerkesztő, a készletet publikáló natív app-plan/apply/journal művelet, source image-stamp/revision kötés, WebP generálás, automatikus owner-scaffolding, viewport/DPR méretválasztás és valódi UI/production teljesítménymérés még következő feladat. Az alkalmazási asset/source referencia-leltár, export/import és szélesebb GC nincs kész. Az interaktív borító későbbre marad.

A zárolás a jelenlegi egyprocesszes M0 repositoryra igazolt; nem többhostos CAS- vagy production rollout-bizonyíték. Az éles SenseNet-környezetben a host-szintű regisztrációk támogatását még nem igazoltuk; ezt az app-bekötés és élesítés előtt ellenőrizni kell. Éles séma/extension/konfiguráció bevezetése külön owner által engedélyezett lépés.

Tulajdonló források: [policy](../deployment/extensions/m0-timeline-security/ImageAssetPolicy.cs), [scope observer](../deployment/extensions/m0-timeline-security/ImageAssetScopeObserver.cs), [PNG-validátor](../deployment/extensions/m0-timeline-security/PngVariantValidator.cs), [provision](../scripts/m0-image-variants-provision.cjs), [natív smoke](../scripts/m0-image-variants-smoke.cjs). A preload szabványos működésének elsődleges forrása: [.NET runtime startup-hook design](https://github.com/dotnet/runtime/blob/main/docs/design/features/host-startup-hook.md).
