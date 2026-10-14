# Story 11 - Clone or Fork Public Timelines

> **Status audit — 2026-10-14:** Hiányzik. Nincs clone/fork service, handler vagy route; a README kész-funkció állítása hibás volt.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

## User Story
**US011 – Clone or Fork Public Timelines**
> As a user, I want to duplicate another user's public timeline to build my own variant version.

## Acceptance Criteria
- [ ] User can clone any public timeline
- [ ] Cloned timeline becomes user's own timeline
- [ ] User can modify cloned timeline independently
- [ ] Original timeline remains unchanged
- [ ] User can see clone relationship (optional)
- [ ] Clone preserves all media items and structure

## Technical Requirements
- Implement timeline cloning functionality
- Create clone relationship tracking
- Add clone permission system
- Implement deep copy of timeline structure
- Add clone history and attribution
- Create clone management interface

## Priority
Low - Nice-to-have feature for community

## Dependencies
- Story 07 (View and Share Timeline)
- Timeline sharing and privacy settings
- Deep copy utilities
