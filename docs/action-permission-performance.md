# Action-alapú kliensjogosultságok és hálózati mérés

## Cél és határ

Az összes oldal böngészős `HasPermission` kéréseinek száma **0**. A betöltött tartalom nem frissül automatikusan időzítőre, fókuszváltásra vagy tabváltásra. A SenseNet és a meglévő alkalmazás-API továbbra is kikényszeríti a tényleges hozzáférést, írási jogosultságot, projektkötést és tartalomrevíziót. Nem változik szerverkód, séma vagy ACL.

## Az adatválasszal érkező jogadat

A kliens az alkalmazási tartalmakkal együtt kéri az expandált `Actions/Name`, `Actions/Forbidden` mezőket, a beágyazott `MediaItem` tartalmaknál is. A `ContextMenu` scenario csökkenti a műveletlista méretét. `metadata=no` mellett elmarad a nagy általános műveletkatalógus. A sikeres tartalom- és bináris-GET maga érvényesíti az olvasási hozzáférést; nem előzi meg külön Open-kérdés.

Az `Actions` mező és a `__metadata.actions` eltérő fogalom. Az utóbbi általános OData-műveleteket is felsorol, és nem jogosultsági bizonyíték. A kliens csak konkrét, expandált action és szigorúan `Forbidden === false` alapján engedélyez gombot. Hiányos, halasztott vagy hibás adatok nem jelentenek engedélyt. A hivatalos leírás: [SenseNet Actions](https://docs.sensenet.com/api-docs/basic-concepts/09-actions/).

| Alkalmazási művelet | Felhasznált jelzés |
| --- | --- |
| Olvasás/megjelenítés | A jelenlegi felhasználóval sikeresen visszakapott tartalom |
| Szerkesztés, meglévő borító feltöltése | `Edit`, `Forbidden=false` |
| Törlés | `Delete`, `Forbidden=false` |
| Új tartalom | `Add`, `Forbidden=false`, továbbá a pontos típus az expandált `EffectiveAllowedChildTypes` között |

Az Edit action a nyers Save jognál szigorúbb lehet: a beépített szerkesztő See/Open/OpenMinor/Save jogokat igényel. A generikus Create/Update/Remove és az Upload action nem helyettesíti ezeket a jelzéseket. A ContextMenu nem tartalmazza az Add actiont, ezért a létrehozási ellenőrzés teljes, scenario nélküli, szűkített szülőleírót használ.

## Betöltött állapot és írási védelem

A tartalomazonosítók és az útvonal-aliasok a SenseNet nagybetűzéstől független útvonalkezelését követik. A kisbetűs `conan the barbarian` route és a visszakapott `Conan the Barbarian` Path ugyanahhoz a tartalomhoz tartozik. Ezt külön cache- és tényleges szolgáltatási regressziós teszt ellenőrzi; eltérő célpontot továbbra sem fogad el.

A megjelenítési adatok a repositoryhoz és az aktuális identitáshoz kötöttek; bejelentkezésváltás és explicit invalidálás megszünteti az előző eredményt. A jogosultsághook és a már betöltött képek nem indítanak időzített, fókusz- vagy visibility-lekéréseket. A UI action-cache alapértelmezés szerint explicit invalidálásig vagy új tartalomválaszig él, legfeljebb 2048 azonosító-/útvonalbejegyzéssel. Hiányzó leírók egy összetett, projektre és konkrét célpontokra szűkített OData-GET-be kerülnek; nincs elemenkénti HasPermission. Új oldal, szűrés, kézi újratöltés és saját mentés betöltheti az aktuális adatokat. A hitelesítés kezdeti felépülése külön olvasási hullámot indíthat.

A korábbi 30 másodperces hook új action-`query` kérést indított, majd az írási gombok láthatóságához használt readiness-ellenőrzés 15 másodperces cache-e lejártával a `capabilities` és `lookup` is ismétlődött. A generált képek saját időzítője emellett az `image-presentation` végpontot kérte. Ezek a tartalommegjelenítéshez szükségtelen háttérhívások megszűntek. A még nem látható képek görgetéskor töltődnek be, és nagyobb megjelenési mérethez szükség esetén nagyobb variáns tölthető le.

Másik admin időközbeni változtatását vagy jogvisszavonását a megnyitott lap nem követi élőben: a már megkapott tartalom a következő adatbetöltésig látható maradhat. Új tartalom-/bináriskérés és minden valódi írás továbbra is aktuális szerveroldali ellenőrzést kap. Kijelentkezés/identitásváltás továbbra is azonnal elfedi és eldobja a korábbi kliensállapotot.

Valódi írás előtt a kliens külön, friss összetett action-választ kér az összes érintett célpontra; nem a megjelenítési cache-ből engedélyez. Megmarad a natív gateway rendelkezésreállásának ellenőrzése, a csak olvasható mód, a pontos létrehozható típus, az identitás-/revízióellenőrzés és az alkalmazás-API szerveroldali validálása. A támogatott friss ellenőrzés legfeljebb 1000 külön célpontot és 16 000 karakteres kódolt URL-t fogad; túl nagy ellenőrzés írás előtt megáll.

## Helyi ellenőrzés

A saját, elkülönített böngészős teszt ugyanazokat a helyi tartalmakat és szerkesztő/olvasó/látogató fiókokat használja. A főoldal alapnézete, az összesített timeline-lista, a 31 elemes Alien–Predator–Blade Runner timeline és a médiatár szerepel benne. A teszt fókuszváltás után és legalább 31 másodperc nyugalmi időben is figyeli a hálózatot, a jogosultságoknak megfelelő gombokat és a képek dekódolását. A főoldal alapnézete és All nézete külön minta.

A kiinduló mérési ablakok: főoldal 3 kártya, 108 helyi HTTP-kérés / 10 HasPermission; All 20 kártya, 156 / 30; timeline 31 kártya, 347 / 236. A timeline mintája időben korlátozott, egy kérése még függőben volt. A párhuzamos tesztek, eltérő megnyugvási ablakok és natív gateway-kérések miatt ezekből nem állítunk általános betöltésiidő-gyorsulást. A HasPermission-szám, a helyes műveletgombok és az egy hullámon belüli összetett kérés darabszáma külön elfogadási feltétel.

A hosszú első jelöltteszt a nullára csökkent HasPermission mellett még húsz külön action-leíró kérést talált a médiatárban. Az egyes hookok külön időzítői okozták; először közös ütemező készült, majd Joe tartalommegjelenítési döntése alapján az automatikus ütemezés teljesen megszűnt. Az eredeti, hibát kimutató bizonyítékok is megmaradtak.

A korábbi, közös ütemezős változat 12 oldal/szerepkör kombinációjában nulla volt a teljes böngészős életciklus HasPermission-száma; egy fókusz-/időzített frissítési hullám legfeljebb egy összetett action-kérést indított. A mért editor-ablakokban a főoldal `108 → 102`, az All nézet `156 → 129`, a 31 elemes timeline `347 → 101` helyi HTTP-kérést mutatott. Ezek történeti kérésdarabszámok; a navigálás előtti dokumentumról átnyúló kérések és a párhuzamos futások miatt nem betöltésiidő-benchmarkok. Az aktuális elvárás már **nulla automatikus tartalomkérés** nyugalomban és fókusz-/tabváltáskor.

A normál OIDC editor saját UUID-s timeline-t hozott létre, szerkesztett és törölt az app szolgáltatásain keresztül. Három friss összetett ellenőrzés és három sikeres natív apply kizárólag a saját tesztazonosítót érintette; a rekordszám `3009 → 3010 → 3009`, a végén az elem 404. A meglévő eredeti és generált képek hash-e, az aktív borító és a felhasználó félbemaradt készlete változatlan. A hosted próba a kis-/nagybetűs útvonal hibáját is külön feltárta; a javítás ezt a valós válaszformát kezeli.

Parancsok: `npm test`, `npm run test:parity`, `npm run lint`, `npm run build`. A célzott tesztek: `tests/display-permissions.test.mjs`, `tests/operation-guard.test.mjs`, `tests/library-navigation.test.mjs`, `tests/native-creation-retry.test.mjs`, `scripts/test-native-read-availability.mjs`.

Saját kézi próba: frissítsd a Docker appot. Nyisd meg a timeline-listát, egy timeline-t és a médiatárat; várd meg a betöltést, majd töröld a Network panel sorait. Görgetés/módosítás nélkül válts fókuszt és tabot, várj legalább 65 másodpercet. `query`, `capabilities`, `lookup`, `image-presentation` és `HasPermission` nem ismétlődhet. Újratöltés/szűrés továbbra is az aktuális tartalmat kéri. Editorral a megfelelő műveletek láthatók; olvasóként és látogatóként csak olvasási felület jelenik meg. Tényleges írási próbához saját teszttartalmat használj.

Az audit, az eredeti és javított hálózati mérések, a reprodukálható saját tesztharness és a képernyőképek a gitignored `deployment/.local/action-permission-2026-11-06/` alatt vannak. Az előző képtárolási felületet ez nem alakítja át; lásd [képméretek és borítók](image-variants-usage-and-rollout.md).
