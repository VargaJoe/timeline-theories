# M0 ellenőrzés és kézi átadás – 2026-10-13

Kanonikus checkout: `D:\dev\gitjoe\timeline-theories`. Branch: `feature/m0-local-foundation`, develop alap: `04990d3b8f9f3dec667dde40141e90f5f9b0c0d5`. A tesztelendő végső commitot és a developra célzott PR-t a chat átadása rögzíti. Joe tesztel és merge-el; merge, automerge és deploy nem történt.

## Elfogadási bizonyíték

| M0 terület | Tényleges ellenőrzés |
| --- | --- |
| Helyi runtime és profil | Izolált `timeline-m0`, trusted HTTPS, külön SQL/auth/repository volume-ok; explicit local default és transportból blokkolt production-readonly írás. Mindkét kliensbuild és lint PASS. |
| Indulás és olvasási hiba | A setup-on-import és lookup-error→create megszűnt. Unit és böngészős 404/401/403/500/abort fault injection külön ellenőrzi a nulla tartalomírást. A fault injection nem production próba. |
| Adatátvétel és séma | MCP source snapshot `2026-10-13T14-32-10-703Z`: 2998 record, 66 Timeline, 1428 entry, 1437 média, 7 típus/őstípus séma. 1503 bináris mező SHA256-je egyezik; nulla mező-, referencia-, sorrend- vagy bináris eltérés. Old→new ID-map és szándékos ismételt előfordulás megmaradt. |
| Backend jogosultság | 13/13 CRUD smoke, 74/74 domain/reference/binary/lifecycle próba; Visitor és valódi authorization-code PKCE Reader/Editor. Négy típus direct/expanded metadata és bináris Open-védelme, elutasított referencia megőrzése, raw-ID index, első create és normál/végleges Delete igazolt. |
| Privát tartalom és versenyhelyzet | 46/46 privacy check, 12 publish/hide kör és 2580 olvasási minta. Nulla non-public HTTP200 és nulla redaktált fallback. Csak valódi `NodeIsOutOfDateException` számít stale konfliktusnak. |
| Böngészős folyamat | 2026-10-13 17:43:01 UTC: 32/32 PASS, valódi formos OIDC Reader/Editor. Visitor és Reader 0 repository írás, Editor 19; CRUD, reorder, upload, ZIP, mixed-target deny, reference redaction, cache revocation, új dokumentumig kivárt logout és Delete igazolt. 9 saját UUID-fixture eltávolítva, source 2998 → 2998. A négy végső screenshot vizuális QA-ja PASS. |
| Adatmegőrzés újraindításkor | 17:46:24 UTC: saját SQL/auth/repository stop/start után 2998/2998 record és 1503 binary SHA256 egyezik, nulla mező-, referencia-, sorrend- vagy bináris eltérés; ID-map hash változatlan. Restart után valódi PKCE Reader/Editor login PASS. A 18 korábbi fájl (631641439 byte) SHA256-je változatlan. |
| Kliens és karbantarthatóság | 47/47 unit/contract teszt, lint, local és readonly build PASS. A .NET 8 security extension 0 warning/0 error, a betöltött DLL hash-e egyezik a host builddel. Valódi két-tabos Chromium storage-próba PASS; ez nem production SNAuth login. |

A full verify és a teszt-fixture cleanup a teljes `/Root/Content/timelines` halmazt vizsgálja. A source rekordok nem szerkesztődtek a smoke során. Snapshotok, accountok, ID-map, tanúsítványok, reportok és képek az ignored `deployment/.local/` alatt maradnak.

## Másolható ellenőrzés

A branch lekérése után, a kanonikus checkoutban:

```powershell
npm ci --prefix client
./deployment/scripts/m0-bootstrap.ps1 -TrustCertificate
npm run dev
```

A futó dev folyamatot hagyd meg; másik terminálban:

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

A backendtesztekhez befejezett helyi restore kell. A teljes adatátvétel parancsai és a snapshot-határok: [m0-local-data.md](m0-local-data.md). A Playwright/Chromium útvonal explicit `M0_PLAYWRIGHT_MODULE_PATH` / `M0_CHROMIUM_EXECUTABLE_PATH` változóval felülírható; a default a felhasználói Codex runtime. HTTPS-hibát a helper nem kerül meg.

Rövid kézi smoke a `https://localhost:8080` oldalon:

1. Ellenőrizd a local sáv repo/auth célját. Visitor és `M0Reader`: public olvasás működjön; `/create`, `/media-library/create`, add-entry és privát URL legyen tiltott.
2. `M0Editor`: saját új, alapból privát Timeline; új média és ugyanannak két külön entryje; Notes edit, `Reorder Entries` → `Save New Order`, cover upload, ZIP export/import. Reload után a mentés, sorrend és két előfordulás maradjon.
3. Privát kép megnyitása után `Logout`: korábbi privát szöveg/kép tűnjön el. Új editor login után a saját entry/timeline/media Delete működjön; az átvett source adatot hagyd meg.
4. Saját runtime stop/start után ismét olvasd a source-t. Ez megőrzi a volume-okat és tanúsítványokat; a Vite külön folyamat. Profilváltoztatásnál külön Vite restart kell.

A pontos UI-labeles részletes lépések: [m0-client-safety.md](m0-client-safety.md). A login form `LoginName`-et vár (`M0Reader` / `M0Editor`); helyi jelszó csak az ignored accounts.json fájlban van.

## Belső review és korlátok

A kliens/service/transport diff, a bootstrap/snapshot/restore és a helyi backend extension külön belső review-t kapott. A valódi próbákból származó javítások: Choice-tömbök és dirty-only media patch; profilok közti SNAuth storage; publikus ZIP-preview mutációja; stock Reference/Open metadata rés; explicit üresre normalizált kapcsolatírás; OData Path metadata és native deletion lifecycle. A végső eredmény csak a javítások után megismételt, sikeres integrációra támaszkodik.

A helyi backend policy egy repository processre és a provisionált helyi szerepekre érvényes. Tiltott targetet tartalmazó query egészében elutasulhat. A több lépéses import nem tranzakció: egy későbbi valódi backend hiba hagyhat korábbi sikeres lépést; ismert kezdeti permission deny mellett nulla írás indul. Explicit MediaItem unlink nincs: null/üres kapcsolat módosítása tiltott, a teljes entry Delete külön támogatott.

A project-data snapshot nem teljes identity/security/database mentés, és nem tranzakciós production export. Az eredeti audit/generált metaadat a snapshotban megmarad, a helyi rendszermezőket a helyi szerver adja. A termék ZIP exportja továbbra sem lossless backup.

Dependency audit: 37-ről 10 jelzésre csökkent (3 high, 7 moderate, 0 critical). A fennmaradó főverzió-/SDK-cserék nem részei az M0-nak. Production login/ACL, UI-redesign, Trakt tartalmi/időrendi/pagination javítás, lossless publikus export és agent API továbbra is külön szelet. Production frontend nem volt megnyitva; production írás nem történt. Élő Trakt-provider import működését a helyi bulk-preflight próba nem igazolja.
