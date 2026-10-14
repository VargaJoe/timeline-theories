# Story 07 - View and Share Timeline

> **Status audit — 2026-10-14:** Részleges; privacy út tesztelt. Publikus URL és IsVisible létezik. Share-link kezelés és teljes chronological/release nézetváltó nincs. A rendes timeline lekérése Position szerinti, mentett SortOrder mellett is.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

## User Story
**US007 – View and Share Timeline**
> As a user, I want to view my timeline in a clean interface and share it via a public link with read-only access.

## Acceptance Criteria
- [ ] User can view timeline in clean, organized interface
- [ ] User can toggle between chronological and release order views
- [ ] User can generate public sharing link
- [ ] Public link provides read-only access
- [ ] Shared timeline maintains formatting and media
- [ ] User can revoke public access

## Technical Requirements
- Create timeline display component
- Implement sorting toggle functionality
- Add public sharing mechanism
- Create read-only timeline view
- Implement sharing link generation and management
- Add privacy controls

## Priority
High - Core functionality for timeline consumption

## Dependencies
- Story 01 (Create New Timeline)
- Story 06 (Organize Timeline Entries)
- Public/private timeline settings
