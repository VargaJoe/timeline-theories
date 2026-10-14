# Timeline Theories dependency-karbantartás 2026-10-13

2026-10-14 M1 friss állapot: a remote develop `f62710d5` már tartalmazta a külön #50 Router7 merge-et. A user által előírt React17-kompatibilitás miatt az M1 feature branch a két client package fájlt a jelen dokumentum `f53774ac` Router6 baseline-jára állítja vissza; nincs force/legacy-peer-deps vagy React-major migráció. Az alábbi bejegyzés a 2026-10-13-i karbantartás történeti eredménye.

Joe kifejezetten engedélyezte a nyitott Dependabot PR-ek developba merge-ét. Az M0 PR47 korábbi merge commitja e25b394697a392837968e4dbafa204986ea26567; a végső dependency baseline `f53774acbc586f382d999e339bdb1b00d7f1d951`. A kanonikus checkout developon áll. M1 megvalósítás nem indult; a külön handoff dokumentumok untracked helyi fájlok, a következő M1 branch review-olt dokumentációjába kerülhetnek.

## Merge eredmény

Mind a11eredetileg nyitott PR merge-elve. Három közben létrejött, kompatibilis javítás (#48/#51/#52) is beolvadt. A botágak a merged M0-val összeegyeztetve, non-force push és az adott final HEAD GitHub Actions kapuja után kerültek merge-re, expected_head_sha ellenőrzéssel.

| PR | Állapot | Merge commit |
| --- | --- | --- |
| [#33](https://github.com/VargaJoe/timeline-theories/pull/33) | merged | ad559fe9 |
| [#34](https://github.com/VargaJoe/timeline-theories/pull/34) | merged | f3c3a77c |
| [#35](https://github.com/VargaJoe/timeline-theories/pull/35) | merged | 163f19dc |
| [#36](https://github.com/VargaJoe/timeline-theories/pull/36) | merged | 428a1529 |
| [#38](https://github.com/VargaJoe/timeline-theories/pull/38) | merged | 8bbe0b72 |
| [#39](https://github.com/VargaJoe/timeline-theories/pull/39) | merged | 7a4cb771 |
| [#41](https://github.com/VargaJoe/timeline-theories/pull/41) | merged | d4f0da49 |
| [#43](https://github.com/VargaJoe/timeline-theories/pull/43) | merged | 65cda9ec |
| [#44](https://github.com/VargaJoe/timeline-theories/pull/44) | merged | 20c48c56 |
| [#45](https://github.com/VargaJoe/timeline-theories/pull/45) | merged | a1287aeb |
| [#46](https://github.com/VargaJoe/timeline-theories/pull/46) | merged | 01114a7e |
| [#48](https://github.com/VargaJoe/timeline-theories/pull/48) | merged | 1c549d6f |
| [#51](https://github.com/VargaJoe/timeline-theories/pull/51) | merged | ff78c1fd |
| [#52](https://github.com/VargaJoe/timeline-theories/pull/52) | merged | f53774ac |

Hat kliens-PRnél az M0 már újabb javított verziókat tartalmazott; ezeket megtartottuk, a PR-ek historyja merge-elve lett. A #36 kizárólag a típuscsomagot frissíti, a DOMPurify runtime3.4.17 megmarad. A root #46 a kliensben már tesztelt3.4.17-re frissült. A root #33 régi6.14.2 célja helyett a jelenlegi [qs advisory](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) szerinti6.16.0 került be. DOMPurify forrás: [3.4.17 release](https://github.com/cure53/DOMPurify/releases/tag/3.4.17).

A végső M0 utáni alkalmazásdiff csak négy package fájl:137insert/76delete, nincs app-, backend-, schema- vagy env-kódmódosítás. A csomaglockban a modul-metaadatok/integrityk megmaradnak. npm install --prefix client csomagnév nélkül mellékhatásként file:.. self-dependencyt adott; még #36 merge előtt eltávolítottuk, a végső delta csak7insert/6delete két client package fájlban. Frozen npm ci sikeres. Nincs audit --force, SDK-downgrade vagy ellenőrzésgyengítés.

## Végső verziók

| Csomag | Root | Client |
| --- | --- | --- |
| DOMPurify |3.4.17|3.4.17|
| qs |6.16.0|nincs rootként használt frontenddependency|
| proxy-addr |2.0.8|nem frontenddependency|
| path-to-regexp |8.4.0|külön frontenddependency nincs|
| lodash |4.18.1|4.18.1|
| body-parser |2.3.0|nem frontenddependency|
| react-router-dom |6.30.6|6.30.6|
| @remix-run/router |1.23.4|1.23.4|
| Vite |nem rootdependency|7.3.7|
| @types/dompurify |nem rootdependency|3.2.0 natív típusokat használó stub|

## Nyitva maradt új PR

[#50](https://github.com/VargaJoe/timeline-theories/pull/50) ReactRouter7.18.4 major update; final observed head31eb6eb43aba2de30742e0d96eaa28bf248db875. GitHub Actions és Netlify failed. A konkrét installhiba: npm ERESOLVE, react-router-dom7.18.4 peer React>=18, a projekt React17. A root és client történeti UI/SenseNet/OIDC peer-gráfjával ez külön React/UI/SDK migráció. Nem merge-eltük hibás builddel és nem használtunk force/legacy-peer-deps kerülőutat. A végső friss PR-listában ez az egy PR maradt nyitva; új botfutás később új PR-t nyithat.

## Ellenőrzések

A14merge-elt PR megfelelő HEADjén client-and-snapshot-contracts GitHub Actions SUCCESS. A Netlify több dependency-previewt változatlan assetek/queue miatt canceled/neutral eredménnyel jelölt; ezek nem sikeres új deploy-bizonyítékok. A tényleges összevont developon külön futtattuk:

- Frozen root npm ci és client npm ci PASS, utóbbinak végső package fájljai azonosak a merge-elt típusfrissítéssel.
- 51/51unit/contract és lint PASS.
- Production, explicit M0 és readonly build PASS; normál production build Netlify-szerű process envvel, user env változtatás nélkül.
- Actual Chromium33/33:2026-10-13T20:56:39.619Z, report deployment/.local/browser-smoke/f28b171c-c4ec-4490-a936-69385e1918c3/report.json. Visitor0/Reader0/Editor19mutáció;9UUID-fixture cleanup,source2998→2998. M0 CRUD,ZIP,sorrend,borító,Open-revoke,logout,private-deny,DeathWishdirect/card éssame-documentrecoveryPASS.
- Valódi local backend13/13,2fixture cleanup PASS.
- Native Chromium auth-storage2026-10-13T21:05:06.338Z PASS: két-tabos/reopen/profilizoláció és session/idegenkulcsok megőrzése.
- 18legacy/env file hash változatlan. Saját M0 Vite localhost8080 és a timeline-m0 runtime futva marad; tesztböngészők lezárva. User adat, .env és Docker volume nem lett törölve.
- Root modulpróba PASS: az advisoryhez kapcsolódó qs parse→stringify nem dob hibát; path-to-regexp paraméteregyezés és proxy-addr címgyűjtés működik a ténylegesen telepített csomagokkal.

A korábbi változatlan C#74reference/46privacy/2580read és2998record/1503binaryhash persistence-bizonyíték az M0 átadásban marad. Itt a .NET/schema nem változott; a backendösszes safety claimet nem nevezzük újrafuttatottnak.

## Audit és scope

Root lockfile audit17találat(1critical/5high/10moderate/1low) →10(0critical/3high/7moderate/0low). Client10(0critical/3high/7moderate), a régi SDK/OIDC/Quill/router tételek megmaradnak. Ez dependency-gráf audit, nem teljes alkalmazásbiztonsági minősítés. Ignored adatok: tmp/root-dependency-audit-before.json, tmp/root-dependency-audit-after.json, tmp/client-dependency-audit-current.json.

A dependency-merge engedély erre a karbantartásra szólt. Az új M1 session egy új feature/m1-trakt-import-data-contract branch és develop PR; M1 merge/automerge/deploy Joe-nál marad. Az M1 teljes beolvasás, occurrence/entity azonosság, preview/egyeztetés, idempotens resume, lossless csomag és sorrendnézetek. [Teljes indítóprompt](m1-session-prompt-2026-10-13.md). Production SenseNet/ACL írás nem történt. Artifactok, credentialök, reportok és binaryk ignored maradnak.
