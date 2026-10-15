# Story 21 - Manually Enrich Media Details from Trakt

> **Status audit — 2026-10-14:** Részleges/átfedés. Story22 bulk preview/apply provideres út létezik. Dedikált media-detail Update from Trakt és egyedi diff UI nincs.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

**As a user, I want to manually update a media item’s details from Trakt, so I can keep information accurate and up to date.**

## Technical Breakdown & Tasks
- Add "Update from Trakt" button to media item detail page.
- Fetch latest details for the media item from Trakt using its ID.
- Show a diff/preview of changes before applying.
- Update media item with selected new data.
