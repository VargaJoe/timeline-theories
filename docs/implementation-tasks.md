# Timeline Theories — implementation status and next work

Updated 2026-10-14 against develop `f53774acbc586f382d999e339bdb1b00d7f1d951`.

The [feature audit](feature-status-audit-2026-10-14.md) is the current status register for Stories 01–32. Story acceptance criteria describe intended behavior; old checkboxes are not proof that every criterion works. The former Planned/Completed checklist mixed duplicate stories, obsolete architecture and unverified completion claims; this register replaces that classification.

## Delivered foundations

- Timeline, media and entry creation/editing/deletion; media reuse through distinct occurrences; complete position reordering; chronology notes and arc fields.
- Public timeline browsing and concrete repository permissions, including shared-media and binary-cover targets. M0 local snapshot/restore and environment preservation.
- Existing Trakt list import. Joe confirms the important lists are already imported. Further import hardening is backlog work.
- Metadata preview/apply, book search/import and book editing are implemented. M1 verifies live OMDb, TMDB and Open Library; the stored Trakt credential is rejected. See the current acceptance record for exact limits.
- ZIP/TSV import/export with existing-local-media references, ABC browsing and incremental loading, covers, OIDC and alternative SNAuth mode.
- M0 [PR #47](https://github.com/VargaJoe/timeline-theories/pull/47) and authorized [dependency maintenance](dependency-maintenance-2026-10-13.md) are merged. Fresh origin/develop also contains Router 7 PR #50; this M1 branch restores React 17-compatible Router 6 as required by the commission. A React major migration remains separate work.

## M1 implementation and validation

The feature branch implements the commissioned shared UI/native gateway using the standard independent SenseNet API. [M1 connection and hosting](m1-native-api.md) records authentication, persistent shared coordination, inventory coverage and retry limits. [M1 verification](m1-verification.md) maps each operation to UI/domain/HTTP/ACL and actual test evidence. The preserved commission below remains the scope reference; it is not a claim of deployment to production.

### Accepted M1 commission

An external assistant must reach the site's existing domain operations through an authenticated HTTP API: search/read, media and book metadata/covers, timeline management, distinct entry occurrences and explicit ordering, metadata proposals, and existing import/export. Include real writes and an external-client → local SenseNet → UI demonstration in this milestone.

The UI and API share validation and permission rules. Supply capability/OpenAPI discovery, scoped access, read-only preview, explicit apply, retries without duplicate writes, version conflicts and useful operation results. Preserve data, editorial order and environment selection.

The complete implementation commission is [M1 agent API session prompt](m1-agent-api-session-prompt-2026-10-14.md). [API documentation](api-documentation.md) describes the shared native gateway and browser services. The [2026-10-13 Trakt-first prompt](m1-session-prompt-2026-10-13.md) is superseded.

## Deferred work

- Trakt pagination/identity/retry improvements and lossless portable export/import, when another migration/backup use case needs them.
- Missing provider search/rating/trending/discovery; cloning, advanced tags, cross-references and combined timelines; personal reading progress.
- Complete release/chronological view switching preserving editorial Position. Publisher-series ordering exists, but does not make every sorting criterion complete.
- Broader UI/mobile work and React/SDK major migration. Choose the next bounded milestone after the actual M1 content-management workflow is proven.

Supabase/Clerk proposals, admin-email heuristics and browser/static API-key authentication are not current requirements. SenseNet ACLs remain authoritative. Ordinary .env/hosting configuration chooses the target; only explicit M0 commands choose the isolated local profile. Implementation-agent tests/writes remain local; Joe retains merge/deploy control.
