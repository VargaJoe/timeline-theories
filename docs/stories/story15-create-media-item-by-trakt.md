# Story 15 - Create Media Item by Trakt

> **Status audit — 2026-10-14:** Hiányzik külön keresőként. Listaimport médiát készít, de nincs dedikált Trakt search/select/autofill media-create UI.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

**As a user, I want to search for and add a media item using Trakt data when creating a new media item, so I can quickly import accurate details.**

## Technical Breakdown & Tasks
- Add a "Search Trakt" button or field to the Media Item Create Page.
- Integrate Trakt API search endpoints for movies and shows.
- Display search results with key info (title, year, poster).
- On selection, auto-fill the media item form with Trakt data.
- Allow user to edit imported details before saving.
- Save Trakt IDs with the media item for future reference.
