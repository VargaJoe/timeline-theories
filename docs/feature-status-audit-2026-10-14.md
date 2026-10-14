# Timeline Theories — funkció- és dokumentációaudit

M1 implementációs kiegészítés: a natív `/api/v1` és közös UI gateway a feature branchben elkészült; aktuális működés/telepítés/korlátok: [M1 API](m1-native-api.md), tényleges elfogadási bizonyíték: [M1 verification](m1-verification.md). Az alábbi audit a kiinduló develop állapotát őrzi meg, nem production deploy státusz.

2026-10-14. Forrás: kanonikus checkout, develop `f53774acbc586f382d999e339bdb1b00d7f1d951`, Stories 01–32, M0 bizonyítékok és Joe aktuális visszajelzése. Ez forrásaudit és a meglevő tesztbizonyíték egyeztetése; minden korábbi funkció teljes production újratesztelése nem történt.

A **Trakt-listaimport meglévő, használt funkció**. Joe szerint a fontos listákat már áthozta. Az importközpontú M1 prioritást visszavontuk. A következő mérföldkő **natív alkalmazási API tényleges tartalomkezeléshez**, olvasással és írással, közös UI/API szabályokkal. [Új sessionprompt](m1-agent-api-session-prompt-2026-10-14.md).

## Bizonyíték és státusz

Megvalósított: konkrét forrásút létezik. Részleges: a történet egy része megvan, a teljes elfogadási lista nem. Hiányzik: a felmért alkalmazási útvonalakon nincs megvalósítás. A frissen tesztelt állapot külön minősítés. A storyk régi checkboxai követelmények/historikus állítások; aktuális besorolásuk az alábbi táblázat.

A merged baseline ellenőrzései 2026-10-13-on: 51 unit/contract, lint, normál/M0/readonly build, 13 valódi local backend próba, 33 valódi Chromium próba és külön auth-storage smoke. A 33-as jelentést most újraolvastam: `deployment/.local/browser-smoke/f28b171c-c4ec-4490-a936-69385e1918c3/report.json`, ranAt 2026-10-13T20:56:39.619Z, minden check sikeres, sourceCount 2998 → 2998. Visitor/Reader 0 írás; editor 19 művelet, saját fixture cleanup. Ezeket a dokumentációváltozás miatt nem futtattam újra.

Bizonyított UI utak: timeline/media/entry create/edit/delete, egy médiára két külön előfordulás, teljes kézi sorrendmentés, bináris borító, meglévő local média-ID-s ZIP roundtrip, Visitor/Reader deny, batch-preflight, revoke/logout/cache ürítés, privát kinyitott referenciák védelme, Death Wish subfolder média direkt/kártyás olvasása. Minden provideres dúsítás sikere, könyvimport-variáció, teljes mobil UX és production admin írás nincs ezzel igazolva.

## Stories 01–32

| Story | Funkció | Aktuális státusz | Forrás / korlát |
| --- | --- | --- | --- |
| 01 | Timeline létrehozás | Megvalósított; M0 UI/backend tesztelt | TimelineCreateForm + timelineService.createTimeline; default-private új timeline. |
| 02 | Globális média | Megvalósított; CRUD/borító tesztelt | MediaItemCreateForm, MediaLibraryPage, mediaLibraryService; élő provider siker külön ellenőrizendő. |
| 03 | Média hozzáadása | Megvalósított; tesztelt | TimelineEntryCreatePage + createTimelineEntry; ellenőrzött, projekten belüli médiareferencia. |
| 04 | Ismételt médiaelőfordulás | Megvalósított alap; tesztelt | Külön entry ID/Name/Position/Notes ugyanazzal a MediaItem ID-val. Külön repeat_label nincs; EntryLabel/Notes létezik. |
| 05 | Külső forráslinkek | Részleges | ExternalLinks form/JSON/persist/display és provider ID parsing létezik; külön validátor/típusfüggő ajánló nincs. |
| 06 | Entry rendezés | Megvalósított alap; tesztelt | Position, drag/keyboard reorder, kézi pozíció, dátum/leírás/ArcGroup. Story12 átfedés; több PATCH, nincs atomikus vagy concurrent mentési garancia. |
| 07 | Megtekintés/megosztás | Részleges; privacy út tesztelt | Publikus URL és IsVisible létezik. Share-link kezelés és teljes chronological/release nézetváltó nincs. A rendes timeline lekérése Position szerinti, mentett SortOrder mellett is. |
| 08 | Belépés | Részleges; helyi OIDC tesztelt | OIDC és SNAuth mód van. Supabase/Clerk onboarding, Google/GitHub login, regisztráció/profil/reset nincs. Admin használat az aktuális cél. |
| 09 | Média tagek | Részleges | Tags create/edit/persist/display van; autocomplete/tagcloud/teljes tagszűrő nincs. |
| 10 | Timeline keresés/szűrés | Részleges | ABC/All/pagination/név- és CreationDate rendezés van. Timeline kulcsszó/tag/médiatípus kereső nincs; MediaLibrary cím/leírás kereső külön funkció. |
| 11 | Clone/fork | Hiányzik | Nincs clone/fork service, handler vagy route; a README kész-funkció állítása hibás volt. |
| 12 | Timeline management | Megvalósított alap; tesztelt | Timeline/entry edit/delete és reorder. A tényleges könyvtár react-beautiful-dnd; nem dnd-kit. |
| 13 | Más appból migráció | Részleges; Trakt használatban | Story17 legalább egy importforrást teljesít; általános IMDb/scraping/multi-provider migráció nincs. |
| 14 | Trakt ihlette UI | Megvalósított; teljes UX audit nélkül | TopNavigationBar, PageHeader, card/action layout létezik; minden mobil/accessibility kritérium nem frissen igazolt. |
| 15 | Média Trakt keresőből | Hiányzik külön keresőként | Listaimport médiát készít, de nincs dedikált Trakt search/select/autofill media-create UI. |
| 16 | Entry Trakt keresőből | Hiányzik külön keresőként | Listaimport és kézi select/create van; egyedi Trakt kereső munkafolyamat nincs. |
| 17 | Trakt-listaimport | Megvalósított; Joe használta | traktService, TraktImportDialog, trakt-proxy; meglévő timeline-ra apply és fetchOnly út. Nem account sync vagy általános dedup/review/apply motor. |
| 18 | Trakt rating import | Hiányzik | Média Rating/provider metadata nem személyes Trakt-rating import. |
| 19 | Discovery/Trakt kereső | Hiányzik | Nincs önálló kereső és timeline-lefedettség kijelzés. |
| 20 | Trending ajánlás | Hiányzik | Nincs trending feed és timeline matching. |
| 21 | Egyedi Update from Trakt | Részleges/átfedés | Story22 bulk preview/apply provideres út létezik. Dedikált media-detail Update from Trakt és egyedi diff UI nincs. |
| 22 | Bulk metadata update | Megvalósított forrás; élő siker nem frissen igazolt | BulkUpdateDialog + mediaUpdateService: OMDb/TMDB/Trakt preference/fallback, missing/overwrite, preview/approval, retry/backoff. M0 teljes célhalmaz deny esetén 0-write/0-provider-fetch próbát igazol. |
| 23 | Action gombok | Megvalósított | Icon/tooltips/gombcsoportok. M0 Visitor Export/Trakt rejtést és célműveleti kapukat igazol. |
| 24 | Smart multi-source merge | Részleges/átfedés | Provider prioritás/fallback és diff van; mezőnkénti többforrás provenance/konfliktusválasztó nincs. |
| 25 | Entry cross-reference | Hiányzik | Nincs többentry-referencia és kétirányú UI. Média reuse nem ez a funkció. |
| 26 | Entry tags/universe/loop | Hiányzik | Média Tags, ArcGroup és EntryLabel van; külön entry tag rendszer/universe nézet nincs. |
| 27 | Többtimeline-nézet | Hiányzik | Nincs combined/alternating/tag-aware rendering. |
| 28 | ZIP/TSV adatcsere | Megvalósított; korlátozott roundtrip tesztelt | Aktív timelineExportService + timelineImportService: 19 oszlop/borítók, meglévő local media ID. Nem lossless cross-repo backup. A régi checklist Story28 Auto Media Creation neve másik, meglévő select/create alfunkciót jelölt. |
| 29 | Könyv/publisher series | Részleges | BookMediaItem öröklés/mezők/edit, OpenLibrary/GoogleBooks search/select/import, series-detektálás, publisher-series típus/PublicationYear sort van. Nem teljes publisher feed sync/series management; élő teljes import nem frissen igazolt. |
| 30 | Olvasási haladás | Hiányzik | Nincs reading status, személyes rating/reading note/date/stat rendszer. |
| 31 | Query/image optimalizálás | Részleges | Pagination, LazyImage concurrency/auth/anon/fallback van. Nincs react-window/virtualized MediaLibrary; image localStorage cache nincs; entry list minden 100-as lapot olvas, nem csak 50-et. Általános performance-célokhoz nincs mérési bizonyíték. |
| 32 | ABC lapozás | Megvalósított | TimelineList ABC/All/URL filter/incremental skip/top/szerverrendezés van. Betűnézet is lapoz; a régi csak-All-lapoz állítás elavult. |

Forrásprefix: `client/components/`, `client/pages/`, `client/services/`; schema: `deployment/contenttypes/`. A tracked Netlify functions között csak a Trakt providerproxy van. Express/pg npm dependency nem bizonyít futó alkalmazásszervert. A nyers SenseNet OData/MCP és a teszt-helper nem az oldal tervezett agent API-ja.

## Egyéb késznek jelentett állítások

- Admin-only MediaLibrary/email/group heuristics: M0 felváltotta konkrét célműveleti jogokkal. Visitor olvashat publikus Open-jogú médiát. Menü vagy login nem backend-jog.
- Dual auth: két kódút és scoped browser-storage létezik; local OIDC E2E és natív auth-storage smoke nem minden production login igazolása.
- Memo mint jelenlegi típus, Supabase/Clerk mint jelenlegi backend: elavult terv. Aktuális Timeline/MediaItem/BookMediaItem/TimelineEntry XML és a konfigurált cél sémája az irányadó.
- M0 helyi provisioning/snapshot/restore/OIDC és megőrzés igazolt. Régi local API key feladat nem az új agent API credential-adási mintája.
- Health/cert/startup: az izolált M0 runtime és explicit bootstrap igazolt; nem minden régi Compose/automatikus OS certificate-trust ígéret teljesítése.
- Maintenance/env módok léteznek. Normál .env/hosting target irányadó, production login/deploy külön igazolandó.

## Import és adatcsere minőségi backlog

Traktproxy egy upstream oldalt kér; DEV sample fallback van; rank/notes/list occurrence ID nem marad teljes domainadat; season/episode továbbadás show IDs-t használhat; apply minden elemhez új médiát és index+1 pozíciót készít. Ez egy már létező feature korlátja. Joe adatait nem deduplikáljuk és nem importáljuk újra automatikusan.

ZIP: nem teljes hordozható backup; több mező/azonosság és cross-repo remap hiányzik, import meglévő helyi médiareferenciát használ. Régi helperváltozatok is maradtak; a UI aktív útját az API parity során egyértelműen kell kiválasztani. Teljes új importmotor nem az M1 előfeltétele.

## M1 natív AI/agent tartalomkezelés

Az asszisztens az alkalmazás API-ján keresztül érje el a tartalomfeltöltést és kezelést szolgáló meglévő műveleteket. Gépi capability/OpenAPI, scoped hozzáférés, közös validáció, olvasó preview/explicit apply, retry/idempotencia és tényleges verziókonfliktus-védelem szükséges. SenseNet a kiinduló tárolás; hosting/auth/conditional-write döntés tényleges képességvizsgálat alapján.

Elfogadás: külső, böngészőt nem használó kliens saját helyi timeline-t és médiát készít, kétszer hivatkozik ugyanarra a médiára, jegyzetet/metadata-t szerkeszt, teljes sorrendet ment; deny megáll, retry nem duplikál, közben UI szerkesztés nem vész el; reload után az oldal ugyanazt mutatja. Meglévő provider/import/export műveletekhez explicit parity és korlátleírás kell. Schema/mock/MCP adapter önmagában nem bizonyít működő API-t.

UI redesign, React major, trending/rating, canon-admin, teljes Trakt/lossless átépítés külön backlog. M1 után a valódi content workflow tapasztalatai alapján döntünk. [Aktuális teendők](implementation-tasks.md), [API inventory](api-documentation.md), [dependency baseline](dependency-maintenance-2026-10-13.md).
