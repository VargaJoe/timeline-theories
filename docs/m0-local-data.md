# M0: izolált helyi SenseNet és teljes adatpillanatkép

Az M0 külön `timeline-m0` Compose projektet, hálózatot és SQL/repository/identity volume-okat használ. A repository `https://localhost:41016`, az IdentityServer `https://localhost:41017`; mindkettő csak `127.0.0.1`-en érhető el. Az image-ek digestre rögzítettek. A régi `deployment/dbvolume`, `deployment/temp/certificates`, környezeti fájlok és más projektek konténerei nem részei ennek a futtatásnak.

Minden helyi jelszó, API-kulcs, tanúsítvány, source adat, ID-térkép és ellenőrzési jelentés az ignored `deployment/.local/` alatt van. A frontend saját ignored `client/profiles/local.override.json` fájlja csak a létrehozott helyi SPA client ID-t tartalmazza. Éles frontendböngészés és éles tartalmi írás nem szükséges, és az exportáló nem kínál ilyen műveletet.

## Indítás és megőrzés

A repository gyökeréből, a Dockerhez hozzáférő PowerShell 7-ben, telepített .NET 8 vagy újabb SDK-val:

```powershell
./deployment/scripts/m0-bootstrap.ps1 -TrustCertificate
./deployment/scripts/m0-runtime.ps1 -Action status
```

A bootstrap új, kriptográfiailag véletlen helyi SQL/tanúsítvány/health kulcsokat generál; exportálja a meglévő localhost developer tanúsítványt, és létrehozza a saját volume-okat. A `-TrustCertificate` a Windows aktuális felhasználójának tanúsítványbizalmát kezeli; az első alkalommal Windows jóváhagyási párbeszéd jelenhet meg. Meglévő tanúsítványt nem takarít. A `dotnet dev-certs https --check --trust` ugyanebben a host felhasználói környezetben ellenőrizhető.

Az admin kezdeti API-kulcsát kizárólag a saját, új SQL-ből menti ignored fájlba; nem nyomtatja ki. A provisioning lecseréli az új repository alapértelmezett admin jelszavát, létrehozza az `M0Reader` és `M0Editor` fiókokat, és a helyi SPA clientet. A jelszavak és teszt API-kulcsok a `deployment/.local/accounts.json` fájlban olvashatók helyben. A frontendbe nem kerül admin/reader/editor API-kulcs.

A startup előtt SHA256 megőrzési baseline készül. Ellenőrzés:

```powershell
./deployment/scripts/m0-preservation.ps1
```

A 2026-10-13-i futásban 18 meglévő fájl, 631 641 439 byte változatlansága igazolt. A megőrzési baseline szándékosan nem írható felül. Leállítás/újraindítás:

```powershell
./deployment/scripts/m0-runtime.ps1 -Action stop
./deployment/scripts/m0-runtime.ps1 -Action start
```

Nincs `down -v`, adatbázis-törlés vagy régi volume újrahasználata. A korábbi `insert-apikey.ps1` titkot tartalmazó, globális konténerneveket használó segédprogram visszavonva; az új bootstrap helyettesíti.

## Verziózott helyi séma

A `scripts/m0-provision.cjs` explicit, helyi művelet. Öt tracked XML-t telepít, és a SHA256-eket/verziót a `schema-migration-v1.json` naplóba menti. A frontend oldalbetöltése nem telepít sémát és nem hoz létre struktúrát.

- A `MediaType` megőrzi a production `tvseries`, `tvseason`, `tvepisode` értékeket és a helyi `show`, `season`, `episode` aliasokat.
- `Year` és `SeriesName` opcionális. A restore nem következtet évre címből vagy dátumból. A SenseNet üres Integer mezője 0; ezért a helyi `Year` minimuma 0, a maximum 2100. A korábbi 1800 minimum ténylegesen elutasította az éles forrásban nem létező Year mezővel létrehozott műveket.
- `Rating`: 0–10, alapérték 0; `BookSeriesNumber`: minimum 1.
- A production XML-ek és teljes mezőmetaadatok a pillanatképben külön megmaradnak. Helyi és forrásséma nem mosódik össze.

## Teljes, csak olvasó production pillanatkép

```powershell
node scripts/m0-snapshot.cjs
node scripts/m0-snapshot.cjs --verify deployment/.local/snapshots/<timestamp>
```

Az exporter a Codex konfigurált `sensenet-plastice` HTTP MCP endpointját használja; megőrzi a `Mcp-Session-Id` headert, kizárólag olvasó eszközöket enged, és soha nem nyomtat Authorization/API-key headert. A repository kötelezően `https://plastice.sensenet.cloud/`. A teljes `/Root/Content/timelines` fát stabil ID-sorrendben, lapozva olvassa; mindkét filter explicit kikapcsolt, ezért Hidden és privát tartalom is bekerül. Más project, production user, identity, password, token és kulcs nem exportálható. A rendszermezőkben levő identity hivatkozások kizárási szabálya a manifestben szerepel.

A `contents.json` forrásonként tartalmazza az eredeti ID/path/type értékeket, tisztított nyers MCP mezőket és típusosan normalizált mezőket. Choice és Reference JSON-szövegek valódi tömbbé alakulnak; szöveges JSON (például ExternalLinks) megmarad szövegnek. A hét típus/őstípus XML-je, örökölt mezőmetaadata, időbélyegei és minden fájl SHA256-e is megmarad.

A Binary és CoverImageBin mezők letöltése kizárólag GET, az ellenőrzött source eredet, project content ID és mező `media_src` végpontja alapján, redirect nélkül történik. Nincs külső URL-ekről vagy szolgáltatói credentialből kikövetkeztetett letöltés. Üres opcionális bináris mező is kap manifestbejegyzést és üres-stream SHA256-et.

Ellenőrzött futás: `2026-10-13T14-32-10-703Z`; 14:32:10–14:33:11 UTC:

| Forráshalmaz | Darab |
| --- | ---: |
| Összes project record | 2998 |
| Workspace / Folder | 1 / 66 |
| Timeline | 66 |
| Timeline, Hidden=false | 49 |
| Nem Hidden public / private Timeline | 44 / 5 |
| MediaItem / BookMediaItem | 1429 / 8 |
| TimelineEntry | 1428 |
| Bináris mező, nem üres / üres | 415 / 1088 |
| Bináris byte összesen | 24 470 661 |

A teljes 66 Timeline között IsVisible=true 46, false 20; 17 Hidden. Az identitás-/kulcskizárás miatt ez project-data snapshot, nem teljes SenseNet security/database backup. Nem tranzakciós export: az elején/végén ellenőrzött inventory és másodperces source időbélyegek nem zárnak ki minden közben történt írást. A pillanatkép ellenőrzése sérült hash, hiányzó oldal/mező/bináris, ismételt oldal, duplikált ID/path, scope- vagy referenciarés esetén leáll.

Ez külön formátum a veszteséges alkalmazási ZIP exporttól. Restore-hoz a teljes manifest kell.

## Helyi restore és integritás

```powershell
node scripts/m0-restore.cjs deployment/.local/snapshots/<timestamp>
node scripts/m0-restore.cjs deployment/.local/snapshots/<timestamp> --verify
node scripts/m0-acl.cjs deployment/.local/snapshots/<timestamp>
```

A restore transportja kizárólag a fix localhost repository/auth portokra enged kérést. A source ID-k egy explicit `restore-journal.json` old→new ID-térképet kapnak. Szülők előbb jönnek létre, a belső hivatkozások második menetben kapják a helyi ID-t, és csak utána kerülnek vissza a binárisok. Sem cím szerinti deduplikáció, sem automatikus sorrendjavítás nem történik.

A tartalmi mezők, Choice értékek, referencia-sorrend, Position és ReleaseOrderPosition, ismételt mű-előfordulások és az összes bináris hash ellenőrzött. A server által generált ID/path-depth/version/audit identity mezők helyi értékeket kapnak; az eredeti audit dátum és metaadat a source snapshotban megmarad. Opcionális szöveg null/üres és Choice null/üres tömb reprezentációja szemantikailag összevetett, a nyers source érték továbbra is a snapshotban van.

A restore és a verify a teljes hét forrásséma mezőlistáját előzetesen ellenőrzi, és unsupported, nem readOnly/nem generated/nem identity mezőtípus esetén még helyi írás vagy API-kérés előtt megáll. A `schemaCoverage` a jelentésben név és típus szerint elkülöníti a scalar/reference, Binary, readOnly, server-generated és identity/version kizárásokat. A rögzített source mezőszámok: Workspace 72, Folder 65, Timeline 73, MediaItem 75, TimelineEntry 74, BookMediaItem 80, GenericContent 64; unsupported tartalmi mező egyikben sincs. A Binary ág mind az 1503 mező külön SHA256-ellenőrzését végzi. Az eredeti source alapján külön, API-kérés nélkül is ellenőrzött `restore-schema-coverage.json` megőrzi ezt a coverage bizonyítékot.

Rerun ugyanazzal a content- és teljes manifest-hash-sel a befejezett restore-t ellenőrzi, és nem írja újra. Más snapshot vagy megváltozott, nem a journal tulajdonában levő cél nem írható felül. Elveszett POST-válasz után csak a már journal-tulajdonú szülő alatt, pontos típus/forrásmező egyezéssel fogadható vissza a létrejött elem; eltérés megállítja a restore-t.

A `restore-verification.json` jelentés külön listáz count/field/reference/order/binary eltérést, orphan hivatkozást, duplikált path/Position és ismételt művet. A forrásban egy megőrzött ismétlés van: Arrowerse, source media 4326, entry 4327 és 4329. Nem orphan és nem duplikált pozíció. Az ellenőrzött restore 2998/2998 record, nulla field/reference/binary/order eltérés.

## Valós ACL és ellenőrzés

A production ACL vagy production fiók nem másolódik. A teljes forrás helyileg új ACL-politikát kap:

- Visitor és bejelentkezett M0Reader csak public tartalmat olvas; Save/AddNew/Delete tiltott.
- M0Editor a projectben tényleges Open/Save/AddNew/Delete jogot kap.
- IsVisible=false és Hidden Timeline privát: 22 védett gyökér, öröklődő védelemmel az entrykre és timeline coverre.
- Csak privát timeline-ok által használt 1068 média és borítója szintén privát. Nyilvános timeline által is használt közös mű marad public.
- A privát ACL-k készre állítása alatt a Visitor és az M0Reader project gyökere tiltott. Public hozzáférés csak utána nyílik meg.

A v2 helyi security setup a Visitor és az M0Reader hozzáférését is lezárja a teljes restore/ACL felkészítés alatt. A Timelines container öröklése megszakad; a két olvasó itt csak `localOnly` jogot kap. A meglévő nyilvános timeline-ok külön öröklődő read grantot kapnak, új gyermek pedig olvasási grant nélkül indul. A `SetPermissions` öröklésmódosítás külön `{ "inheritance": "break" }` kérés: nem lehet `r` sorba tenni vagy ugyanabban a kérésben `r` mellett küldeni. A setup ellenőrzi az `inherits:false` eredményt.

A Timeline CTD helyileg a `Timeline.Theories.M0.Security.TimelineSecurityHandler` osztályt használja. A fix helyi olvasók jogait a backend kezeli minden közönséges create/PATCH és bináris mentésnél. Új elemnél konkrét parent AddNew, meglévőnél konkrét target Save ellenőrzés előzi meg a célzott privilegizált műveletet; szerkesztő nem kap SetPermissions jogot. Rosszul beállított, public jogot örökítő parent alatt a handler első mentés előtt elutasítja a létrehozást. Mentés előtt visszavonja a read jogokat; sikertelen mentés zárt állapotban marad. Sikeres public mentés után friss adatbázis-adat alapján adhat újra read jogot. A visibility és Hidden mezőket sorosított mentéssel és friss pre/post-save olvasással kezeli; a változatlan mezőt nem írhatja felül egy korábban betöltött stale objektum.

A build pontos runtime NuGet-verziókat használ (.NET 8; SenseNet ContentRepository/Storage 7.8.2-alpha.6, Security 4.3.1). A `deployment/scripts/m0-build-security.ps1` minden csomagot, HTTP cache-t, CLI home-ot és build outputot az ignored `.local` alatt tart. A Compose a DLL-t read-only mountolja az `/app` könyvtárba; az [official assembly loader](https://github.com/SenseNet/sensenet/blob/f2e58b61fcb4077ba5ce3b5d23d07f0dbb91a82c/src/ContentRepository/RepositoryInstance.cs#L185) ezt startupkor betölti. A bootstrap build→runtime start→schema/account provision→aktuális helyi visibility alapú security setup sorrendben fut. Nem állítja vissza a felhasználó későbbi visibility módosításait a régi snapshot alapján. A save gate egyetlen repository processre érvényes; több példányos production deployment nem része ennek a helyi M0-nak.

A rögzített SenseNet-verzió `GetDynamicDataNameKey()` függvénye a property ID-t pozíciós indexként használja ([NodeData](https://github.com/SenseNet/sensenet/blob/f2e58b61fcb4077ba5ce3b5d23d07f0dbb91a82c/src/Storage/NodeData.cs#L164), [TypeCollection](https://github.com/SenseNet/sensenet/blob/f2e58b61fcb4077ba5ce3b5d23d07f0dbb91a82c/src/Storage/Schema/TypeCollection.cs#L46)). A helyi handler ezért a schema binding ellenőrzött property ID-jával a `GetDynamicDataIdKey()` nyers adatát olvassa. Public grant csak a sikeres mentés után frissen lekért Approved verzió és Finalized mentési állapot mellett adható. Production runtime vagy framework nincs módosítva.

A `DomainReadPolicy` négy helyi típust véd: Timeline, TimelineEntry, MediaItem és BookMediaItem. Az `OnLoaded`, `GetProperty` és `Path` kapu mindig az eredeti caller konkrét target Open jogát vizsgálja, stock `SystemAccount` betöltés alatt is. Minor vagy nem Approved verzióhoz OpenMinor is kell. A Path ellenőrzés az OData URI/deferred-link metaadatokat is védi; egy már korábban betöltött, majd tiltott target nem kerülhet ki a cache-ből protected mezőkkel. Id=0 még nem rendelkezik security entityvel; a natív AddNew/Save és az első Timeline-save private-inheritance kapuja védi. Nincs globális middleware vagy formatter csere. Tiltott targetet tartalmazó collection query egészében is elutasulhat: ez a helyi M0 vállalt availability korlátja.

A natív fizikai törlés eltávolítja a security entityt, majd observer kód még Path-t kérhet. A `DeletionPathScope` kizárólag erre az életciklusra tartja meg a korábban Open és konkrét Delete joggal ellenőrzött pathot: exact Node példány, original caller ID és AsyncLocal delete flow egyezése kell; csak `IsDeleted` + `EntityNotFoundException` mellett használható. A DeleteAsync/ForceDeleteAsync scope finally-ben megszűnik, nested hívás visszaállítja az előző scope-ot. Parallel GET vagy captured child flow nem kap általános olvasási kivételt; a GetProperty/OnLoaded/version kapuk változatlanok. Első mentéshez külön bypass nincs: a stock SecurityHandler a hiányzó új security entityt NodeHead ID/parent/owner alapján helyreállítja. A Timeline-save előellenőrzése is explicit original caller HasPermission; a stock current-user Assert SystemAccount alatti korai returnjére nem támaszkodik.

A TimelineEntry handler csak a MediaItem referencia olvasási vetületét és explicit írását kezeli. A source XML, a helyi `Reference` field regisztrációja és raw ID-k változatlanok; a MediaType stock `Choice` marad. A rögzített framework nem enged egy már létező fieldet más custom field classra cserélni. Ezért a content-handler `GetProperty` csak eredeti caller számára Open-nal elérhető targetet ad vissza, és explicit LastAccessible/LastMajor verziót tölt. Single-reference OData alakja objektum vagy null; nem feltétlen tömb.

Explicit referenciaíráshoz az entryn Save, első mentésnél a konkrét parenten AddNew és minden targeten Open kell. A stock import tiltott incoming targetet null/üres értékre normalizálhat; ezt a setter még a raw kapcsolat módosítása előtt elutasítja. Az explicit null/üres referencia is tiltott: a teljes forrás 1428 entryje mind pontosan egy referenciát tartalmaz, és a frontend entry létrehozása is művet kér. Az omitted MediaItem megengedett a restore első menetében, a második menet explicit referencia-PATCH-e működik. Unrelated scalar PATCH nem hívja a referencia settert. A stock Reference indexer a callerhez szűrt GetData értéket használná; a helyi, kizárólag MediaItemet érintő index adapter a változatlan raw ID-kat indexeli, így egy átmenetileg nem olvasható műre mutató kapcsolatot a scalar save nem töröl az indexből.

Az official backend `HasPermission` az `Everyone` hitelesített role-ra korlátozott; Visitor számára 403 akkor is, ha a public célon SeePermissions engedélyezett. Helyi anonim read előellenőrzéshez a kliens a konkrét célon `GET ...?$select=Id` pozitív egész ID-válaszát használja: ez a backend Open ACL-jét bizonyítja, és semmilyen írásjogot nem jelent. Privát cél 401/403/404 vagy pontos natív read-gate hibával elutasított; ez tiltás, nem create-utasítás. A domain gate ezen a backendverzión HTTP 400, `code:RequestError`, `exceptiontype:SenseNetSecurityException` eredményt adhat, a permission action target betöltésekor is. Sem általános 400/500, sem null/redaktált ID nem pozitív engedély. A production readonly profile nem használja ezt autentikációs fallbackként.

A helyi IdentityServer jelszavas belépése a repository `LoginName` értékét várja: `M0Reader` vagy `M0Editor`. A form email placeholderje ellenére az `Email` érték nem belépési alias. A provision a pontos nevet az ignored `accounts.json` `loginUsername` mezőjében is megőrzi. A `m0-oidc-smoke.cjs` valódi authorization-code + PKCE folyamatot futtat: authorize, antiforgery-protected login form, callback, token exchange és a tokennel repository `GetCurrentUser`; API-keyt nem használ. A rövid életű helyi tokenek kizárólag az ignored `.local/oidc-tokens.json` fájlba kerülnek, credential/token nem jelenik meg a konzolon.

```powershell
node --test scripts/m0-snapshot.test.cjs scripts/m0-restore.test.cjs
node scripts/m0-oidc-smoke.cjs
node scripts/m0-timeline-privacy-smoke.cjs
node scripts/m0-reference-privacy-smoke.cjs
node scripts/m0-backend-smoke.cjs
node scripts/m0-persistence.cjs deployment/.local/snapshots/<timestamp>
```

A backend smoke külön UUID timeline-okon végez valós műveleteket a kanonikus Timelines containerben, majd törli a saját fixture-eit. A korábbi `.local` környezetben levő `/Root/Content/m0-smoke-workspace` megmarad; az új helper nem módosítja. A kanonikus MediaLibraryből csak hivatkozásra olvas meglévő művet; source mezőt/binárist nem módosít. Bizonyítja a public olvasást, Visitor és nonwriter írástilalmát, privát timeline/entry/binary és ID-probe tiltást, editor tényleges create/update/read/delete folyamatát. A tiltott PATCH ezen a backendverzión HTTP 500 + `NotEnoughPermissions` lehet; a domain read gate HTTP 400 + `RequestError` + `SenseNetSecurityException` is lehet. Kizárólag ezek a konkrét natív hibák permission deny-k; általános 400/500 nem. A külön privacy smoke valódi OIDC tokenes editor/reader mellett ellenőrzi az új private tartalmat, hide/publish, Hidden, sikertelen save és konkurens mentés backendjogait; konzolra nem kerül token.

A referencia smoke saját UUID MediaItemet, BookMediaItemet, Timeline-t és TimelineEntryt, valamint saját nem üres cover binárist használ. Visitor és valódi OIDC reader/editor mellett külön bizonyítja a See-allow/Open-deny direct Id-only/selected/all-field és collection tiltást, a selected/all-field `$expand` és reference navigation redakcióját, illetve a közvetlen bináris tiltást. A mentett CTD XML-ben a stock Reference/Choice és mind a négy handler ellenőrzött. Readable explicit reference PATCH működik; denied target/null/empty PATCH megőrzi az eredeti raw kapcsolatot; denied incoming POST után nincs invalid persisted entry. A kétmenetes omitted-reference create→reference PATCH, az unrelated scalar update és a `+Id:<entry> +MediaItem:<media>` index query valós backend út. Mind a négy típus editor first-create, normál Delete és permanent Delete működik. Normál Delete a saját tartalmat Trashba teheti: az eredeti project path 404, és a helper az admin számára még elérhető saját UUID-t is végleg takarítja. A helper source-ID kizárás, exact név/path/ID és végső project count alapján ellenőrzi a cleanupot, és csak utána ment `passed:true` jelentést.

A stock OData [Projector](https://github.com/SenseNet/sensenet/blob/f2e58b61fcb4077ba5ce3b5d23d07f0dbb91a82c/src/OData/Projector.cs#L182) egy mező SenseNetSecurityException hibáját nullra redaktálhatja HTTP 200 válaszban. Ez nem read grant: null ID nem engedély. A race observer `metadata:no` és default metaadat módban is mintáz, az Id/Name/DisplayName/Path/visibility/Description/CoverImageBin alakját ellenőrzi, és partial business/URI/binary metadata redakciót nem fogad el. A final futásban nem volt non-public HTTP200 vagy redaktált fallback; a Path kapu már a canonical URI/deferred metadata előállítását is original-caller Open ellenőrzéshez köti.

A persistence script kizárólag a saját konténereket stop/startolja; az SQL-t és minden volume-ot megtartja. Újraindulás után megismétli a teljes 2998 record/reference/order és 1503 binary hash vizsgálatot, és ellenőrzi az ID-map hash változatlanságát. Az ignored `backend-smoke.json`, `persistence-verification.json` és `restore-verification.json` a részletes helyi bizonyíték. A böngészős OIDC/CRUD ellenőrzés külön szükséges; a tokenes backend smoke önmagában nem helyettesíti.

A 2026-10-13 17:19–17:21 UTC közötti végső DLL-lel futtatott ellenőrzés: referencia 74/74, privacy 46/46, 2580 párhuzamos read minta (260 default metadata válasz), 12 publish/hide kör; nulla non-public HTTP200 és nulla redaktált fallback. Nyolc körben a repository egyik stale kérését konkrét HTTP 400 `NodeIsOutOfDateException` hibával elutasította; más 400 nem fogadható stale conflict-ként. Sikertelen save zárt marad; mindkét sikeres konkurens save után az ACL a persisted visibility mezőkkel egyezik. A helper minden kör végén explicit hide és backend deny ellenőrzést végez. Backend 13/13, exporter/restore tesztek 26/26 PASS. A frissebb full verify 2998/2998 és nulla field/reference/binary/order eltérés, mind az 1503 bináris SHA256 egyezik. A korábbi bootstrap rerun 44 public / 22 private ACL-t állított be, a 18 régi fájl változatlan.

A host build és a read-only `/app` mount DLL SHA256-e egyezik: `f4617eb998c4005691c68c7e89f23f53de1260dade4a01c5500d0e010c51a8f5`; fordítás 0 warning / 0 error. A source snapshot: `deployment/.local/snapshots/2026-10-13T14-32-10-703Z`. Részletes bizonyíték az ignored `reference-privacy-smoke.json`, `timeline-privacy-smoke.json`, `backend-smoke.json`, `restore-verification.json`, `oidc-smoke.json`, `timeline-security-setup.json` és `security-extension-build.json`; ezek csak a localhost runtime eredményei. A privacy és backend helpers is kizárólag saját UUID-vel és source-ID kizárással takarítanak, PASS artifact csak sikeres cleanup után készül.

A végső valódi böngészős futás `2026-10-13T17:43:01.324Z`: 32/32 kritérium, `passed:true`, mind a 9 saját UUID fixture sikeresen takarítva, forrás 2998→2998. A valódi editor CRUD, reader/Visitor írástilalom, referencia expansion, Open-visszavonás utáni cache-hide, logout/private route és binary deny, valamint UI Delete működött. A részletes jelentés: `deployment/.local/browser-smoke/0abbc0d4-220e-4eb4-8f87-61d41ffe85c8/report.json`.

Csak a befejezett böngészős futás és tiszta cleanup után történt a végső saját SQL/auth/repository stop/start. A `persistence-verification.json` `2026-10-13T17:46:24.036Z` jelentése PASS: 2998/2998 rekord, mind az 1503 bináris SHA256 egyezik, nulla field/reference/binary/order eltérés. A restore ID-map előtte/utána azonos SHA256-e `c413db1ad0f4a46be4663af88b621d85facfd7324e0b6795c45d81424183d544`. A postrestart valódi authorization-code + PKCE reader/editor login és repository identity ellenőrzés ismét PASS. A megőrzési script mind a 18 régi fájlt, összesen 631641439 byte-ot változatlan hash-sel találta. A runtime a végső ellenőrzés után futva maradt; minden saját és más project volume megmaradt.
