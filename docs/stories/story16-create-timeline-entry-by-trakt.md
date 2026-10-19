# Story 16 - Create Timeline Entry by Trakt

> **Status audit — 2026-10-14:** Hiányzik külön keresőként. Listaimport és kézi select/create van; egyedi Trakt kereső munkafolyamat nincs.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

**As a user, I want to search for and add a timeline entry using Trakt data, so I can quickly add entries for media I find on Trakt.**

## Technical Breakdown & Tasks
- Add a "Search Trakt" option to the Timeline Entry Create Page.
- Integrate Trakt API search for movies, shows, and episodes.
- On selection, check if the media item exists; if not, create it using Trakt data.
- Auto-fill timeline entry fields (title, date, etc.) with Trakt info.
- Allow user to edit before saving.
- Link the entry to the imported media item.
