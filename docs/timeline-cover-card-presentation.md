# Timeline-kártyák egyetlen letöltött képből

A generált borító egyetlen HTTP-képletöltés marad, miközben a poszterek külön kártyaként fedik egymást és egérre kiemelkednek. A lista, a mentett kép szerkesztői nézete és az új előnézet ugyanazt a legyezős megjelenítőt használja. Érintőképernyőn a nyugalmi kompozíció látható; egy érintés a timeline-ra navigál. A csökkentett mozgás beállítása kikapcsolja a kártyák átmenetét.

## A mentett kép és a megjelenítés

A `poster-strip-v1` fájl továbbra is egymás mellé rendezett, külön kivágható posztereket tárol. A `posterStripLayout.mjs` az eredeti 400 × 200-as koordináták közös leírása; ezt használja a változatlan Canvas-generátor és a CSS-kivágás is. A már publikált képek byte-jai, generációja és SenseNet-útvonala változatlan marad. A fájl önmagában megnyitva posztercsík; a webalkalmazás állítja össze belőle a kártyás nézetet.

Az alkalmazás-API a meglévő aktív képleíróval együtt adja a minimális publikus elrendezést:

```json
{"layout":{"template":"poster-strip-v1","count":3}}
```

Ez nem új SenseNet-mező és nem külön kérés. A forrásazonosítók, hash-ek, seed és a teljes rekonstrukciós recept továbbra is szerkesztői metaadatok. A publikus leíró csak az ellenőrzött sablont és az 1–4 közötti darabszámot tartalmazza. Hiányzó vagy ismeretlen elrendezésnél a kliens a teljes mentett képet jeleníti meg.

## Betöltés és hover

`TimelineCover` a meglévő `LazyImage` letöltési útját használja: viewport, méret/DPR-választás, aktuális hitelesítés, kéréskötés, abort és Blob-felszabadítás. A kép sikeres dekódolása után `PosterFan` több CSS-ablakot jelenít meg ugyanazzal a Blob URL-lel. A keretek, árnyékok és elforgatások a felületen keletkeznek. A hover csak transzformációt és rétegsorrendet változtat; nincs fetch, új Blob, eredeti poszterletöltés vagy időzítő.

A képméret kiválasztása előre számol a kiemelt kártya nagyításával: a helyszélesség 1,5-szereséhez és legfeljebb DPR2-höz választ a meglévő méretekből. A jelenlegi kártyapózok legfeljebb körülbelül 1,30-szoros forrásnagyítást igényelnek. Emiatt az induló fájl lehet nagyobb a régi lapos nézetben választottnál; hoverre további méretet nem kér. Ez továbbra is egyetlen optimalizált kép, nem több teljes eredeti.

Az olvasási tiltás, stale/missing állapot, kijelentkezés vagy identitásváltás elrejti a korábbi kártyákat. Tiltott képhez nincs eredeti fallback. A méretváltáskor érkező régi Blob-load/error esemény nem változtathatja meg az új kép állapotát; a callback a pontos Blobhoz kötött. A generált előnézet URL-je a pontos képkészlethez kötött, és cserekor azonnal kikerül a nézetből, majd felszabadul.

## Scope és ellenőrzés

Az aktív készlet kiválasztott 1–4 posztere emelkedik ki. További timeline-elemek, lapozható/pörgethető kártyasor, újrapublikálás nélküli forráscsere és közösségi/OG-képsablon külön feladat. Nincs folyamatos tartalomfrissítés, SenseNet-bővítés, kép- vagy ACL-migráció.

Ellenőrző parancsok:

```powershell
npm test
npm run test:parity
npm run lint
npm run build
docker compose -f compose.local.yaml up -d --build
```

A célzott tesztek a kivágott területet és sorrendet, a közös Blob használatát, a maximális nagyítást, a hiányos elrendezést, az identitásváltást és a késői kép-eseményeket ellenőrzik. A külön helyi böngészőmérés a meglévő Conan-készletet használja, tartalomírás nélkül; a reprodukálható privát bizonyíték a gitignored `deployment/.local/one-resource-cover-2026-11-07/` alatt van.

Kézi próba: nyisd meg a helyi `timelines?filter=l` listát, majd várd meg a képeket. A Conan-kártyán egérrel járd be a posztereket: az adott kártya előre kerül, a Networkben ugyanahhoz az ownerhez csak egy `/images/9146/.../wN` képletöltés szerepelhet. Betöltés után törölt Network mellett hover/fókusz/tabváltás és 65 s várakozás nem kérhet új tartalmat. A kártyára kattintás továbbra is a timeline-ra visz. Az editor List cover előnézetében ugyanez a kompozíció látható; az előnézet elkészítése önmagában nem publikál.
