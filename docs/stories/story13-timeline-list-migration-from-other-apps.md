# Story 13 - Timeline/List Migration from Other Apps

> **Status audit — 2026-10-14:** Részleges; Trakt használatban. Story17 legalább egy importforrást teljesít; általános IMDb/scraping/multi-provider migráció nincs.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

**As a user, I want to import timelines or lists from other apps (like Trakt, IMDb), so I can migrate my data easily.**

## Technical Breakdown & Tasks
- Research popular timeline/list feature apps (Trakt, IMDb, etc.)
- Investigate if public or free APIs are available for data export
- If no API, research HTML parsing/scraping approaches
- Design migration/import workflow for supported sources
- Implement migration tool for at least one source (API or HTML)
- Add UI for importing timelines/lists from other apps
- Test migration with real-world data
