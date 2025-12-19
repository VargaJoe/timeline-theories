# Story 28 - Export/Import Timeline Data in Custom Format

**As a user, I want to export and import timeline data in a simple, Notepad++-friendly format (CSV/TSV), so I can efficiently manage large amounts of data outside the web UI and bulk update or create timelines.**

## Problem Statement
The current UI is not suitable for bulk editing or creating large numbers of timeline entries. External sources are unreliable, and users need a robust, user-friendly way to manage their data offline and re-import it.

## User Story
- As a timeline owner, I want to export my timeline (and its entries) to a CSV/TSV file that I can edit in Notepad++ or similar tools.
- I want to import such a file to create or update a timeline in bulk.
- I want to specify cover images by URL or filename (if local upload is supported).
- I want the import to fetch images from URLs or match filenames if possible.
- I want clear error feedback if import fails or data is invalid.

## Acceptance Criteria
1. **Export Button**: Add export option to download timeline data as CSV/TSV (UTF-8).
2. **Import Button**: Add import option to upload and process CSV/TSV file.
3. **Format**: Documented, Notepad++-friendly, with columns for all relevant fields (title, description, cover image, etc.).
4. **Cover Images**: Support both URL and filename reference. (ZIP bulk upload is a possible future extension.)
5. **Import Logic**: Allow import into an existing (empty) timeline or as a new timeline. Update or create entries as needed.
6. **Error Handling**: Show clear errors for invalid data, missing images, or failed imports.
7. **Export/Import Both Ways**: Exported files must be re-importable without loss of data.
8. **No versioning required**: Only handle current state, unless trivial to add version info.

## Technical Tasks
- Design CSV/TSV schema and document it (current: basic fields only).
- **Enhance export**: Download and package images in ZIP alongside TSV (currently only URLs are exported).
- Implement import logic with validation and error reporting (support URL download and local file upload).
- UI: Add export/import buttons and dialogs.
- Handle cover image download/upload as described.
- **Expand fields**: Add more timeline entry fields (tags, rating, notes, etc.) to make export more comprehensive.
- Write tests for import/export edge cases.

## Notes

## Format Specification

### File Format
- UTF-8 encoded text file
- Tab-separated (TSV) recommended for Notepad++ compatibility, but CSV (comma-separated) is also supported
- TSV vs CSV: TSV uses tabs (\t) as separators, CSV uses commas (,). TSV is less prone to issues with commas in data.
- Supported by: Notepad++, Excel, Google Sheets, LibreOffice Calc, and most spreadsheet applications

### Fields (Columns)
| Field Name      | Required | Description                                                      |
|-----------------|----------|------------------------------------------------------------------|
| timeline_name   | No       | Timeline name (for reference)                                    |
| entry_name      | No       | Entry Name in SenseNet (unique within timeline, for updates)     |
| title           | Yes      | Title of the timeline entry                                      |
| description     | No       | Description or notes                                             |
| media_type      | Yes      | Type (book, movie, show, etc.)                                   |
| media_id        | No       | Media item identifier (if updating existing)                     |
| cover_image     | No       | URL or filename of cover image                                   |
| date            | No       | Date or order (YYYY-MM-DD or free text)                          |
| position        | No       | Position/order in timeline                                       |
| notes           | No       | Additional notes for the entry                                   |

### Example (TSV)
timeline_id	entry_id	title	description	media_type	media_id	cover_image	date
		The Fellowship of the Ring	First book in the series	book		lotr1.jpg	1954-07-29
		The Two Towers	Second book	book		lotr2.jpg	1954-11-11
		The Return of the King	Final book	book		https://example.com/lotr3.jpg	1955-10-20

### Cover Image Handling
- **Export**: Images should be downloaded and included as files alongside the TSV, ideally in a ZIP archive containing both the TSV and image files. This allows users to modify images locally and re-import them.
- **Import**: Support both URL references (for downloading) and filename references (for local files uploaded alongside the TSV).
- **Current limitation**: Export currently only includes URLs, not actual image files. This needs to be enhanced to download and package images.
- ZIP bulk image upload is a possible future extension.

### Import/Export Rules
- Exported files must match this format and be re-importable without data loss.
- Unknown columns are ignored on import (for forward compatibility).
- Required fields: title, media_type.
- timeline_id and entry_id are only needed for updating existing items.

### Error Handling
- Invalid or missing required fields: show error and skip row.
- Missing images: show warning, allow import to continue.
- Invalid file format: show error and abort import.
