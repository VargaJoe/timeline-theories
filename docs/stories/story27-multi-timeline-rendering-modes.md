# Story 27 - Multi-Timeline Rendering and Viewing Modes

## User Story
**US027 – Multi-Timeline Rendering and Viewing Modes**
> As a user, I want to choose how timelines are rendered when there are crossovers, loops, or parallel events, so I can view the story in universe order, binge order, or by tag/group.

## Acceptance Criteria
- [ ] User can select different timeline rendering modes:
    - [ ] Universe order (entries from all timelines in chronological order)
    - [ ] Universe date order with secondary sort (e.g., release order)
    - [ ] Binge-watching order (grouped by tag, e.g., watch all of one arc before switching)
- [ ] Timeline entries from multiple timelines can be shown in a combined view
- [ ] UI allows switching between rendering modes
- [ ] Entries are grouped/alternated according to selected mode
- [ ] Tag and cross-reference logic is respected in rendering

## Technical Requirements
- Implement rendering logic for each mode
- Update timeline view UI to allow mode selection
- Combine entries from multiple timelines as needed
- Respect tags and cross-references in rendering
- Test all rendering modes for correctness

## Priority
Medium – Enhances user experience for complex timelines

## Dependencies
- Story 25 (Timeline Entry Cross-References)
- Story 26 (Timeline Entry Tagging for Loops, Universes, and Parallel Events)
- Timeline view rendering logic
