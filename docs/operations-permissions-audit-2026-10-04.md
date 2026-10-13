# Műveletek és jogosultságok auditja — 2026-10-04

A [fő audit](revival-audit-2026-10-04.md) és a [backend-felmérés](backend-storage-audit-2026-10-04.md) kiegészítése Joe pontosítása alapján. Ez forráskód- és olvasó MCP-vizsgálat, nem jogosulatlan írópróba vagy elkészült javítás.

## A MediaLibrary-eset helyes értelmezése

Nem volt szándékos új tartalom-létrehozás. Az alkalmazás a megnyitás mellékhatásaként indított egy hibás Folder-létrehozási próbát. Ez nem érvényes felhasználói művelet ebben a folyamatban; a mappa típusának általános strukturális megengedettsége nem teszi azzá.

A `client/scripts/setupMediaLibrary.ts:21` a `repository.load` **bármilyen hibáját** hiányként kezeli; nem csak 404-et, hanem akár 401/403-at vagy hálózati hibát is. Utána POST-ol a projektgyökér alá. A modul importja és az App mountja is elindítja, hitelesítés/jogosultság ellenőrzése előtt. Ez erre a konkrét útvonalra igazolt viselkedés, nem állítás az alkalmazás összes 404 válaszáról.

Joe rögzítette: Visitornak nincs létrehozási joga. A Visitor identitás MCP-n igazolt: `/Root/IMS/BuiltIn/Portal/Visitor`, User, Id=6. A konkrét létrehozási jog MCP-ellenőrzése `SiteUrl is missing` hibával meghiúsult; a jogállítás forrása Joe, nem a sikertelen permission-tool eredménye. Az API-kulcsos root AllowedChildTypes nézet más kontextus, és nem bizonyít Visitor-jogot.

A hibás alkalmazási művelet oka ismert: olvasási hiba → automatikus létrehozás, megfelelő jogosultsági kapu nélkül. Az ezt megelőző load-hiba pontos oka külön kérdés; nem a nem kért létrehozás engedélyezésével kell javítani.

## Ellenőrzött kliensoldali hiányok

| Út/művelet | Jelenlegi ellenőrzés vagy rés | Szükséges M0-követelmény |
| --- | --- | --- |
| Privát tartalom olvasása | TimelineViewPage:184 már lekéri a metaadatot; csak utána, :215-nél ellenőriz IsVisible/login állapotot, a login itt is admin-hozzáférés helyett áll | Privát olvasás tényleges céljoga és szerver ACL; ismerten tiltott célt a kliens nem kér le, a jogosultsági metaadat nem szivárogtat védett tartalmat |
| App indulás, MediaLibrary setup | Modulimportkor és mountkor automatikus load/POST; minden load-hiba hiánynak számít | Runtime setup eltávolítása; explicit helyi provisioning, külön cél- és jogellenőrzéssel |
| Timeline/MediaItem létrehozó oldalak | `AuthenticatedContent` csak user/isLoading alapján enged, `App.tsx:57,65` | Létrehozási jog a konkrét szülőre és engedélyezett tartalomtípusra is szükséges |
| `/timelines/:timelineId/add-entry` | `App.tsx:70` nincs AuthenticatedContent kapu; a page/form/service nem ellenőriz céljogot | Direct route, vezérlő, handler és szolgáltatási művelet is ellenőrzött; Visitor ne indíthasson média/entry POST-ot |
| Timeline edit/delete, entry edit/delete, reorder/import | A TimelineViewPage több gombja csak `isUserAuthenticated` alapján jelenik meg; közvetlen PATCH és szolgáltatásból DELETE/POST | Bejelentkezés helyett tényleges célműveleti jog; tiltott handler ne küldjön írókérést |
| Adminnak látszó médiatár/admin vezérlők | IsAdmin név/csoport/email alapú; üres adminEmails esetén bármely bejelentkezett user igaz lehet (`TopNavigationBar.tsx:28`, `MediaLibraryPage.tsx:46`, `configuration.ts:28`) | Ne email-lista vagy adminnak tűnő UI legyen a céljog helyettesítője; hiányzó jogosultsági adat ne engedjen műveletet |
| Közös CRUD szolgáltatások | TimelineEntryService, MediaLibraryService, timelineService közvetlenül írnak; nincs közös műveleti permission-kapu | Az író művelet határán is jogosultságellenőrzés, nem csak gombelrejtés |
| Import meglévő elem keresése | A legacy `timelineService.ts:102–110` minden load-hibából hiányra következtet, majd create ágba kerülhet | 401/403/hálózati hiba nem hiány; explicit importterv és külön engedélyezett létrehozási lépés |
| Közös mű szerkesztése és borítófeltöltés | Entry edit modal külön a referált MediaItemet is módosítja; upload POST a mű szülőjének upload végpontjára megy | Entry-, média- és bináris művelet joga külön ellenőrzött; timeline szerkeszthetősége nem ad automatikusan jogot a közös műre |
| Book/Trakt/ZIP import és bulk metadata update | Több külön célra, többlépéses írás; nincs egységes előzetes céljog-terv | Kötelező részműveletek és célok előzetes ellenőrzése; tiltás esetén nem indul a batch |

A `client` forrásán végzett célzott permission/hasPermission/allowed-actions keresés nem talált repository-alapú műveleti kaput. Ez kliensoldali hiány, nem bizonyíték arra, hogy a backend elfogadná a tiltott írást. Production írókérést nem küldtem a vizsgálat során.

## Elfogadott működési szabály

1. A nyilvános olvasás maradhat Visitor számára elérhető. Oldalbetöltés és olvasási hiba soha nem indít tartalmi POST/PATCH/DELETE/upload kérést.
2. Módosító művelethez explicit felhasználói szándék és a konkrét célra érvényes műveleti jogosultság kell. A login önmagában nem szerkesztési jog. A privát olvasás és a szolgáltatói kulcsokhoz való hozzáférés szintén valódi jogosultságot igényel; ismerten tiltott célt nem kérünk le.
3. A felület csak jogosult műveletet kínál fel. A route, a handler és a közös műveleti szolgáltatás is védi az indítást. Hiányzó, lejárt vagy nem betölthető jogosultságnál az írás tiltott, az olvasási hiba érthetően megjelenik.
4. Létrehozásnál a szülő/céltípus, módosításnál és törlésnél a konkrét tartalom a jogellenőrzés célja. Sorrendmentésnél az összes érintett entry, importnál minden kötelező média/entry/update/upload részművelet ellenőrizendő.
5. A 404 önmagában sem létrehozási utasítás. Explicit, jogosult importterv megállapíthat hiányt és kérhet új elemet; a 401/403 vagy transporthiba nem változhat ilyen tervvé.
6. A backend minden kérést továbbra is saját ACL-lel ellenőriz. A kliens előzetes ellenőrzése a tiltott próbák és hibás UX elkerülésére szolgál; időközben változó jogosultságnál a szerver dönt. Tiltás után a batch megáll, nincs create/fallback vagy további írópróba.
7. Kijelentkezés, identity-/repository-váltás vagy jogosultságváltozás érvényteleníti a korábbi műveleti állapotot. Későbbi agent API ugyanezeket a közös műveleti szabályokat használja.

## M0 ellenőrzési terv

Kizárólag izolált local repositoryn, a tényleges SenseNet jogosultságokkal:

- Visitor és bejelentkezett, írásra nem jogosult identitás: public olvasás működik; oldalbetöltés, közvetlen add-entry URL, form/handler/service indítás és tiltott import nem küld tartalmi írókérést.
- Jogosult szerkesztő: engedélyezett műveletek ténylegesen végigmennek; a nem engedélyezett cél vagy részművelet előzetesen megállítja az indítást.
- Setup/import lookup 404, 401, 403 és hálózati hibái külön esetek. Egyik olvasási hiba sem indít automatikus provisioninget; nem hiány jellegű hiba nem indít explicit import-create lépést sem.
- Jog- vagy loginváltozás a dialógus/batch megnyitása után: elavult UI-állapotból nem folytatható írás. A szerver tiltását a kliens tisztán kezeli, további írópróba nélkül.
- A szerver ACL-jét külön local ellenőrzés bizonyítja, hogy a megkerült kliensből érkező tiltott kérést is megtagadja. Productionon ilyen írópróba nem történik.

A teljes production ACL-lista a jelenlegi MCP permission-tool SiteUrl-hibája miatt még nincs felmérve. Ezt és a belépés külön hibáját nem tekintjük kijavítottnak. M0-ban a fentiek integrált helyi ellenőrzése szükséges.
