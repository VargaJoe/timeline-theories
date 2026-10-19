# Timeline Theories API and service inventory

Source audit: 2026-10-14, develop `f53774acbc586f382d999e339bdb1b00d7f1d951`.

## M1 implementation

The feature branch now implements HTTPS `/api/v1` capability/OpenAPI discovery, ACL-scoped reads, owner-issued revocable credentials, saved preview/apply plans, existing content writes, complete order, sourced metadata/provider/book operations and active ZIP exchange. UI writes use that same gateway. SenseNet stays independent and uses standard HTTP operations; no M1 .NET extension is required. Durable shared application coordination covers all gateway writers; direct repository administration is outside its boundary. See [connection, hosting and recovery](m1-native-api.md) and [operation parity and verified limits](m1-verification.md).

The following sections preserve the preimplementation source audit; their descriptions of missing native routes and raw browser writes apply to the cited baseline.

## What exists today

The React/Vite application talks to SenseNet OData through browser services. A Netlify function fetches Trakt lists. This checkout currently has no application-domain /api/v1, OpenAPI document, capability endpoint or native agent content-management API. The configured SenseNet MCP and scripts/m0-local-api.cjs are backend/audit and test tooling, not the site's general application API.

Repository/auth/project-root values come from validated environment configuration. Ordinary dev/build respects standard Vite .env precedence and hosting process variables. Explicit dev:m0/build:m0 select the isolated local JSON profile. Optional read-only does not change the target. See [README](../README.md) and [feature audit](feature-status-audit-2026-10-14.md).

## Existing browser services

These are TypeScript imports, not public HTTP routes. Source interfaces are authoritative; the former illustrative request shapes and getTimeline/listTimelines functions were inaccurate.

| Domain | Source and operations | Current limits |
| --- | --- | --- |
| Timelines | client/services/timelineService.ts: createTimeline, getTimelines, deleteTimeline, getTimelineMediaCovers | getTimelines(includePrivate, characterFilter, skip, top, sortOrder). Detail loading/edit/visibility also use guarded repository calls inside TimelineViewPage; no exported getTimeline or listTimelines. |
| Media | mediaLibraryService.ts: createMediaItem, getMediaItem, getMediaItemByName, getMediaItems, updateMediaItem, deleteMediaItem, uploadMediaItemCoverImage | BookMediaItem adds Author/Publisher/ISBN/PublicationYear/BookSeriesNumber/SeriesName. Image resizing uses DOM/canvas; do not import the entire browser module unchanged into a server. |
| Occurrences | timelineEntryService.ts: listTimelineEntries, createTimelineEntry, updateTimelineEntry, deleteTimelineEntry, updateEntryPositions | Distinct ID/Name/MediaItem/Position/chronology/Notes/label/arc/importance. Listing exhausts 100-item pages. Reorder preflights all targets then sends separate PATCHes; not atomic or conflict-safe. |
| Trakt lists | traktService.ts: fetchTraktList(username, listSlug); TraktImportDialog applies imports | Movie/show/season/episode mapping; DEV may use sample JSON. Existing usable list import, not complete pagination/idempotent reconciliation/account sync. |
| Metadata | mediaUpdateService.ts: fetchUpdateData, analyzeChanges, processBulkUpdate, getRateLimitStatus; BulkUpdateDialog | Provider preference/fallback, preview/approval, missing-only/overwrite and retry/backoff exist. Current OMDb/TMDB/Trakt paths load repository-backed provider keys via loadApiKey. New API must move provider secrets to a server adapter and never expose them in response/log/browser configuration. |
| Books | bookImportService.ts: searchOpenLibrary, searchGoogleBooks, searchBooks, convertToImportData, getBookDetails; BookImportDialog | Search/select/import exists. No publisher-feed sync or resumable deduplicated import. |
| Data exchange | timelineExportService.ts: exportTimelineAsZip; timelineImportService.ts: prepareTimelineImport, importTimelineFromZip | Active UI uses 19-column timeline_data.tsv plus covers; existing local media IDs required, occurrence Name retained, project membership and all target rights checked. Legacy helpers remain in timelineService and are not an equivalent portable contract. |

Source directory: client/services/. Components are in client/components/, pages in client/pages/. The [32-story register](feature-status-audit-2026-10-14.md) distinguishes implemented, partial and missing features from test proof.

## Existing provider HTTP function

`/.netlify/functions/trakt-proxy?username={username}&list={listSlug}` is implemented by client/netlify/functions/trakt-proxy.cjs. The browser uses GET. The function reads server TRAKT_API_KEY, fetches one upstream list-items response and returns JSON. Missing input:400; missing provider config:503; upstream failure:upstream status; transport failure:502. This function supplies no application-domain CRUD or account synchronization.

## Actual content locations and schema

projectRoot comes from `VITE_PROJECT_ROOT_PATH`, via client/profile.mjs and projectPaths.ts. Explicit local M0 default: /Root/Content/timelines.

- Timelines: `${projectRoot}/Timelines/{Name}`. DisplayName, Description, SortOrder (chronological/release), TimelineType (chronological/publisher-series), IsVisible and covers.
- Media: `${projectRoot}/MediaLibrary/.../{Name}`; subfolders are valid. Name is a slug, not automatically numeric ID. Custom MediaItem and BookMediaItem types are in deployment/contenttypes/.
- Entries: children of the selected timeline; historical sibling TimelineEntries content remains preserved. Do not assume a required timeline/TimelineEntries subfolder or relocate source data.
- EntryLabel choices include firstappearance/mainstory/flashback/cameo/reference/other. Importance includes essential/important/optional/skipok. Retrieve allowed values from the actual target schema; SenseNet Choice responses may be arrays.

## Authentication and permissions

M0 proves local OIDC PKCE reader/editor login. Alternative SNAuth mode has scoped browser-session storage and separate storage smoke coverage; not all production login paths are proved. VITE_OIDC_AUTHORITY/VITE_OIDC_CLIENT_ID configure OIDC; VITE_AUTH_TYPE selects the supported provider mode. Old Supabase registration/social-login proposals are not implemented.

sensenet.ts and operationGuard.mjs enforce Open for reads, AddNew plus AllowedChildTypes for creation, Save for update/upload and Delete for removal. Check all concrete targets before the first write and recheck at dispatch; unknown/failed checks deny. For anonymous reads use actual exact-target GET because native HasPermission rejects Visitor. Backend ACLs protect data/references/binaries. Readable timeline/entry does not grant shared-media Save. Login/menu visibility is not permission.

## Planned M1 application API

This section is the next scope, not available endpoints. Full implementation commission: [M1 agent API session prompt](m1-agent-api-session-prompt-2026-10-14.md).

Provide HTTPS JSON /api/v1, machine-readable capabilities and OpenAPI. An external client gets a base URL and authorized credential through secure operator configuration. A thin CLI/MCP adapter is optional; direct API use must work without visual browser automation or mandatory MCP registration. No in-app LLM is required.

Include search/list/detail, media/book CRUD and covers, timeline CRUD/visibility, occurrence CRUD/reuse/full-order changes, metadata proposal/preview/apply and existing import/export. Publish a parity matrix: an unsupported existing operation is an explicit blocker or agreed follow-up, not silently omitted or advertised as available. Existing import quality debt remains backlog unless it blocks this API workflow.

Share domain validation/operation planning between UI/API, with separate browser-auth/display and server-transport/provider-secret adapters. Scoped API permissions intersect actual SenseNet rights and project/target boundaries. Optional read-only blocks writes on the same configured target. Changes need read-only preview, explicit apply, validation, idempotent retry, actual version/conflict protection, safe partial-failure results and credential-free audit records. A gateway cannot lend broad owner rights to arbitrary repository calls.

Settle framework/hosting/auth from current Netlify/SenseNet constraints in the implementation session. Conditional-write and transaction claims require real backend proof; an in-memory preview check is not concurrency protection. Test an external process against isolated SenseNet, reload the UI to see the same result and retain all M0 permission/data-preservation gates.

Provider quotas and hosting allowances are operational values, not hard-coded facts in this document. Check current provider configuration/documentation when operating or implementing a live path. Build/fixture/mock alone is not successful live-provider proof.
