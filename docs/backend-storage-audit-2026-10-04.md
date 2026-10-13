# Production SenseNet tárolási audit — 2026-10-04

Joe által beállított `sensenet-plastice` MCP-kapcsolaton, a `https://plastice.sensenet.cloud/` repositoryból olvasott állapot. Kapcsolat, tartalomtípusok, XML definíciók, elemszámok és reprezentatív előfordulás–mű kapcsolatok ellenőrizve. A fő [újraélesztési audit](revival-audit-2026-10-04.md) kiegészítése; nem teljes integritási vagy restore-vizsgálat.

## Tényleges tárolási fa

```text
/Root/Content/timelines                    Workspace, Id=1736
├── MediaLibrary                          Folder, Id=1763
│   ├── 911                               gyűjtőmappa
│   │   └── 9-1-1 (2018) S04E02            MediaItem, Id=3166
│   ├── Star Wars                         gyűjtőmappa
│   ├── Lethal Weapon                     gyűjtőmappa
│   └── további mappák és közvetlen művek
└── Timelines                             Folder, Id=1764
    └── 911                               Timeline, Id=3151
        └── 9-1-1 (2018) S04E02            TimelineEntry, Id=3167
            ├── Position = 8
            └── MediaItem → Id=3166
```

A `MediaItem → TimelineEntry → Timeline` modell az éles adatokban is megvan. A timeline Folder-leszármazott, a mű és az előfordulás GenericContent-leszármazott. A mű nem a timeline gyereke: külön médiatárban él, az előfordulás referenciával kapcsolja a listához. A médiatár almappákat is használ; a globális médiaolvasásnak a teljes fát kell kezelnie.

## Élő sémák és mezők

Az MCP-n letöltött XML definíciók alapján:

| Típus | Lényeges mezők/szabályok |
| --- | --- |
| MediaItem | Title, Subtitle, Description, MediaType, ReleaseDate, ChronologicalDate, ExternalLinks, CoverImageUrl/CoverImageBin, Duration, Genre, Rating, Tags |
| TimelineEntry | Egyetlen MediaItem referencia; AllowedTypes=MediaItem; SelectionRoot=/Root/Content/timelines/MediaLibrary; Position, ReleaseOrderPosition, ChronologicalDate, ChronologicalDescription, Notes, EntryLabel, IsOptional, ArcGroup, Importance |
| Timeline | AllowedChildTypes=TimelineEntry; Description, SortOrder, IsVisible, TimelineType, Category, borító, Tags, ViewCount, LikeCount |
| BookMediaItem | MediaItem-leszármazott; Author, Publisher, ISBN, PublicationYear, BookSeriesNumber |

A rugalmas ChronologicalDescription már létezik, legfeljebb 200 karakter. A Choice mezők a kinyitott médiahivatkozásban valódi tömbként jelennek meg; a lekérdezési MCP-eszköz az ilyen értékeket JSON-t tartalmazó szövegként adja vissza. Az ExternalLinks LongText, a mintákban JSON-formátumú URL-eket vagy szolgáltatói azonosítókat tárol. Nem önálló, típusos külsőazonosító-kapcsolat.

## Elemszámok

MCP `GetCountOfContentsByQuery`, explicit `autoFilterStatus=0`, `lifespanFilterStatus=0`, a projekt megfelelő részfájára szűkítve:

| Halmaz | Darab |
| --- | ---: |
| Tárolt Timeline | 66 |
| Timeline, Hidden=0 | 49 |
| MediaItem és leszármazottai, Hidden=0 | 1437 |
| TimelineEntry, Hidden=0 | 1428 |
| BookMediaItem, Hidden=0 | 8 |
| MediaLibrary közvetlen gyerekei | 82 |

A számok megerősítik a korábbi GET pillanatképet. A 8 könyv az 1437 média részhalmaza; a 82 közvetlen gyerek nem a teljes műállomány. A Hidden és az IsVisible külön mező: a 49 nem Hidden timeline nem mind publikus.

## Eltérések a checkout és az élő séma között

- A `deployment/contenttypes/MediaItem.xml` tartalmaz `Year` mezőt; az élő definíció és az MCP összesített mezősémája nem. A frontend olvasná és írná ezt a mezőt. Sémák és kliens közti valós eltérés; írópróbával nem vizsgáltam a következményét.
- A helyi MediaType választék plusz `show`, `season`, `episode` értékeket engedne. Az élő séma csak a `tvseries`, `tvseason`, `tvepisode` változatokat tartalmazza ezekre a formátumokra.
- Az élő Rating 0–10 tartományt és 0 alapértéket enged, a helyi definíció 1–10-et. Az élő BookSeriesNumber minimuma 1, a helyi XML-ben nincs minimum.
- A TimelineEntry XML meződefiníciói egyeznek. A Timeline `IsVisible`, illetve a MediaItem `DisplayName` eltérése csak leíró szövegben látszik.
- A frontendben használt `SeriesName` a vizsgált élő MediaItem/BookMediaItem összesített sémában és a helyi könyv-XML-ben sem szerepel. Ezt is a kliens–séma szerződés részeként kell tisztázni.

Ezért az M0 nem pusztán a checkout XML-jeinek helyi telepítése: meg kell őrizni az élő sémát, tudatosan egyeztetni az eltéréseket, és ellenőrzött, verziózott helyi provisioninget készíteni.

## Meglévő adatminőségi rés a mintában

A 911 lista S04E01, S04E02 és S04E03 előfordulásai külön művekre hivatkoznak: entry/media ID párok 3165/3164, 3167/3166 és 3169/3168, Position 7/8/9. A strukturális elkülönítés tehát ezeknél rendben van.

Mindhárom mű Title és Subtitle értéke null, és az ExternalLinks JSON mindháromnál azonos. Az S04E01 MediaType tömbje üres, a másik kettő `tvepisode`. Ez ténylegesen tárolt hiány/azonosító-összemosódás; három elem alapján nem állítok teljes állományra vonatkozó arányt. A külső azonosítók helyes epizódhoz rendelése külön szolgáltatói egyeztetést igényel. A nevek, pozíciók és hivatkozások megőrzendők, a javítást előnézetben kell elvégezni.

## Korábbi MediaLibrary-hiba új kontextusa

A MediaLibrary létezik. A mostani API-kulcsos MCP-lekérdezésben a projektgyökér kinyitott AllowedChildTypes listája tartalmazza a Folder típust, az élő Workspace típusdefiníciója szintén engedi. Ez más felhasználói/request kontextus, nem Visitor-műveleti jog. Joe rögzítette, hogy a Visitornak nincs létrehozási joga, és ezen az olvasási útvonalon egyébként sem érvényes művelet a Folder létrehozása. Nem volt szándékos új elem létrehozása: az app hibás automatikus próbája jelent meg a logban. Az alkalmazási hiba ismert: bármely betöltési hibából create-re vált, jogellenőrzés nélkül. Csak a megelőző load-hiba pontos oka maradt külön kérdés. Létrehozással nem próbáltam reprodukálni.

Az automatikus frontend setup hibája ettől függetlenül igazolt: betöltési hibából létrehozási kérést indíthat. M0-ban az oldalbetöltés nem írhat; a struktúra külön, explicit helyi setupban jöjjön létre.

A [műveleti és jogosultsági audit](operations-permissions-audit-2026-10-04.md) a teljes kliensoldali műveleti kaput is vizsgálja: a tiltott művelet ne legyen indítható és ne jusson a hálózatig. A Visitor identitás Id=6, a permission probe a GetPermissionshez hasonló SiteUrl-kontextushibát adott; ez nem engedélyező válasz.

## MCP módszer és korlátok

- A konfigurált szervert közvetlen HTTP MCP JSON-RPC-n értem el, mert az új eszközök még nem szerepeltek a chat eszközkatalógusában. Initialize, initialized notification és sessionazonosító megőrzése után kizárólag olvasó eszközöket hívtam.
- Használt eszközök: TestRepositoryConnection, GetServerInfo, GetContentTypes, GetContentTypeSchema, GetContentFields, GetContentsByQuery, GetCountOfContentsByQuery, DownloadFile, GetPermissionsForContent. A HTTP MCP POST szállítás nem tartalomtári írás; Create/Update/Delete/permission-set/upload/copy/move nem történt.
- A szerver Restricted módot jelez, de módosító eszközöket is kínál. Ebből nem következik csak olvasási jogosultság; az audit saját olvasó eszközlistát használt.
- A query eszközök leírása opcionálisnak nevezi a filter paramétereket, a bemeneti séma mégis kötelezőnek jelöli őket. Kihagyásukkal hiba, explicit 0 értékekkel sikeres lekérdezés történt.
- A GetContentFields primitív mezőértékei üres tömbként, a GetContentTypeSchema választékai és gyermek-/referencia-beállításai hiányosan jelennek meg. A tényleges XML és a kinyitott query értékek használhatók ellenőrzésre. Az MCP-séma üres allowedChildTypes listája nem cáfolja az XML szabályait.
- A jogosultságolvasó eszköz `SiteUrl is missing` hibát adott, ezért MCP-s ACL-feltérképezés nem sikerült. A korábbi anonim GET privacy-megállapítás külön, továbbra is érvényes bizonyíték.
- Két későbbi kérés HTTP 404-et adott a használt sessionnel; friss, külön sessionben a célzott epizódlekérdezés sikerült. Ez nem repository-adathiány bizonyítéka.
- Titkos header vagy kulcs nem került a jelentésbe. A szűrt bizonyíték és a hat XML az ignored `temp/audit-sensenet-mcp/` mappában van; ez nem teljes backup. Production tartalmat és jogosultságot nem módosítottam ebben az MCP-auditban.

A későbbi local MCP-kapcsolattal ugyanezek az olvasási ellenőrzések megismételhetők, és az élő/helyi sémák, adatszámok és kapcsolatok összevethetők. Az alkalmazás tervezett közvetlen agent API-ja továbbra is külön alkalmazási műveletekre épülő terv; a mostani MCP a backend felmérését segíti.
