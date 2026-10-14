# Story 06 - Organize Timeline Entries

> **Status audit — 2026-10-14:** Megvalósított alap; tesztelt. Position, drag/keyboard reorder, kézi pozíció, dátum/leírás/ArcGroup. Story12 átfedés; több PATCH, nincs atomikus vagy concurrent mentési garancia.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

## User Story
**US006 – Organize Timeline Entries**
> As a user, I want to drag-and-drop or number items in my timeline to define their order, and optionally group them by arc or date.

## Acceptance Criteria
- [ ] User can drag and drop timeline entries to reorder them
- [ ] User can manually set position numbers for entries
- [ ] User can group entries by story arcs or themes
- [ ] User can set dates for entries (for chronological sorting)
- [ ] Changes are saved automatically
- [ ] Timeline view reflects the new order immediately

## Technical Requirements
- Implement drag-and-drop functionality
- Add position field management
- Create grouping/arc functionality
- Add date field for chronological sorting
- Implement auto-save for position changes
- Update timeline display logic

## Priority
High - Core functionality for timeline organization

## Dependencies
- Story 03 (Add Existing Media Entry to Timeline)
- Drag-and-drop library
- Position management system
