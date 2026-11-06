# Action-alapú kliensjogosultságok és hálózati mérés

## Cél és határ

Az összes oldal böngészős `HasPermission` kéréseinek száma **0**. Ez a megjelenítésre, fókuszváltásra, időzített frissítésre és a kliens tényleges műveleti előellenőrzésére is vonatkozik. A SenseNet és a meglévő alkalmazás-API továbbra is kikényszeríti a tényleges hozzáférést, írási jogosultságot, projektkötést és tartalomrevíziót. Nem változik szerverkód, séma vagy ACL.

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

## Közös frissítés és írási védelem

A megjelenítési adatok a repositoryhoz és az aktuális identitáshoz kötöttek; bejelentkezésváltás és explicit invalidálás megszünteti az előző eredményt. Egyetlen közös 30 másodperces időzítő, fókusz- és visibility-kezelő frissíti az összes fogyasztót. A szükséges leírók egy összetett, projektre és konkrét célpontokra szűkített OData-GET-be kerülnek. Nincs kártyánként vagy akciónként külön hálózati ellenőrzés. A hitelesítés kezdeti felépülése külön olvasási hullámot indíthat.

Valódi írás előtt a kliens külön, friss összetett action-választ kér az összes érintett célpontra; nem a megjelenítési cache-ből engedélyez. Megmarad a natív gateway rendelkezésreállásának ellenőrzése, a csak olvasható mód, a pontos létrehozható típus, az identitás-/revízióellenőrzés és az alkalmazás-API szerveroldali validálása. A támogatott friss ellenőrzés legfeljebb 1000 külön célpontot és 16 000 karakteres kódolt URL-t fogad; túl nagy ellenőrzés írás előtt megáll.

## Helyi ellenőrzés

A saját, elkülönített böngészős teszt ugyanazokat a helyi tartalmakat és szerkesztő/olvasó/látogató fiókokat használja. A főoldal alapnézete, az összesített timeline-lista, a 31 elemes Alien–Predator–Blade Runner timeline és a médiatár szerepel benne. A teszt fókuszváltás után és legalább 31 másodperc nyugalmi időben is figyeli a hálózatot, a jogosultságoknak megfelelő gombokat és a képek dekódolását. A főoldal alapnézete és All nézete külön minta.

A kiinduló mérési ablakok: főoldal 3 kártya, 108 helyi HTTP-kérés / 10 HasPermission; All 20 kártya, 156 / 30; timeline 31 kártya, 347 / 236. A timeline mintája időben korlátozott, egy kérése még függőben volt. A párhuzamos tesztek, eltérő megnyugvási ablakok és natív gateway-kérések miatt ezekből nem állítunk általános betöltésiidő-gyorsulást. A HasPermission-szám, a helyes műveletgombok és az egy hullámon belüli összetett kérés darabszáma külön elfogadási feltétel.

A hosszú első jelöltteszt a nullára csökkent HasPermission mellett még húsz külön action-leíró kérést talált a médiatárban. Az egyes hookok külön időzítői okozták; a közös frissítési ütemező ezt javítja. Az eredeti, hibát kimutató bizonyítékok is megmaradtak.

Parancsok: `npm test`, `npm run test:parity`, `npm run lint`, `npm run build`. A célzott tesztek: `tests/display-permissions.test.mjs`, `tests/operation-guard.test.mjs`, `tests/library-navigation.test.mjs`, `tests/native-creation-retry.test.mjs`, `scripts/test-native-read-availability.mjs`.

Saját kézi próba: frissítsd a Docker appot, töröld a Network panel korábbi sorait, és szűrj `HasPermission`-re. Nyisd meg a timeline-listát, egy timeline-t és a médiatárat; válts fókuszt, majd várj legalább 31 másodpercet. A találatszám maradjon 0. Editorral a megfelelő műveletek láthatók; olvasóként és látogatóként csak olvasási felület jelenik meg. Tényleges írási próbához saját teszttartalmat használj.

Az audit, az eredeti és javított hálózati mérések, a reprodukálható saját tesztharness és a képernyőképek a gitignored `deployment/.local/action-permission-2026-11-06/` alatt vannak. Az előző képtárolási felületet ez nem alakítja át; lásd [képméretek és borítók](image-variants-usage-and-rollout.md).
