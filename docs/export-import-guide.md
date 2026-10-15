# Timeline ZIP/TSV export and import

M1 adds native `exchange/{timelineId}/export` and `/preview` routes plus saved-plan apply. The active UI importer sends one complete approved native batch, including deduplicated cover bytes. Format/local-ID limits below are unchanged. See [M1 API](m1-native-api.md) and [operation parity](m1-verification.md).

Current behavior audited 2026-10-14 against develop f53774acbc586f382d999e339bdb1b00d7f1d951. Active UI: client/services/timelineExportService.ts and timelineImportService.ts. See [feature status](feature-status-audit-2026-10-14.md) and [API inventory](api-documentation.md).

## Supported workflow

Open /timelines/{Name} while authenticated and permitted to read/export the timeline. Use Export Timeline to download a ZIP containing timeline_data.tsv and available covers/. Export controls are hidden for Visitors.

To apply an archive, first open/create the destination timeline, then use its ZIP import control and select the file. The importer parses the TSV, resolves every media_id in the current repository, checks project membership and the complete target permission set, then applies entry changes and included covers. Authentication alone does not grant creation/update/upload rights.

This is a limited entry-editing/copy workflow within a repository that already contains the referenced media. It is not a complete backup or lossless cross-repository migration.

## TSV contract

The active exporter writes 19 columns:

timeline_name, entry_name, Title, Description, MediaType, media_id, cover_image, ChronologicalDate, Position, Notes, EntryLabel, Importance, ChronologicalDescription, Author, Publisher, ISBN, PublicationYear, Genre, Tags.

Fields escape tabs/newlines/carriage returns as literal backslash sequences. Keep the header and entry_name/media_id identities intact when editing. Entry Name must be nonempty, unique in the archive and contain no slash. media_id must be a valid existing positive ID inside the configured MediaLibrary subtree. Position and Choice values must satisfy the destination schema.

The archive does not include every domain field or complete media identity. Exported media description/book/tag columns do not mean that the current import will update those media fields.

## What import changes

- A matching entry_name updates that occurrence. A new entry_name creates a separate occurrence referencing the existing media_id.
- A matching entry whose existing MediaItem conflicts with media_id is rejected. Reusing a media_id across different entry names preserves distinct occurrences.
- Entry title/Position/ChronologicalDate/ChronologicalDescription/Notes/EntryLabel/Importance are applied. Current import does not create missing media or bulk-edit its description/book/tag metadata.
- A named cover must exist in covers/ and requires Save/upload permission on that media. Missing cover files fail preparation; there is no arbitrary cover-URL download fallback in this active import.
- Existing media Open, all entry AddNew/Save and all involved cover Save rights are checked before the first write. Mutating the public operation-preview array cannot bypass the private execution plan.
- A runtime failure after execution begins may leave already-applied entry/cover changes. There is no general transactional rollback or automatic cleanup guarantee. Review actual content before retrying.

## Practical limits

Use this ZIP for occurrence edits or copying entries into a new timeline in the same repository, with preserved local media references. Use MediaLibrary editing or the existing metadata-update dialog for media-field changes. Use M0 snapshot/restore tooling for complete local data-preservation verification, rather than treating this archive as a portable backup.

Current processing is sequential. There is no source-backed universal unlimited row guarantee, fixed 2GB archive promise or general per-image 10MB contract here. Large imports need representative validation against actual browser/repository limits.

Trakt list import is a separate existing feature. Its pagination/reconciliation improvements and a future lossless portable format are backlog; they are not the next milestone. [M1 native content-management API](m1-agent-api-session-prompt-2026-10-14.md) will expose the existing operations with their actual limitations.
