# Story 26 - Timeline Entry Tagging for Loops, Universes, and Parallel Events

## User Story
**US026 – Tag Timeline Entries for Loops, Universes, and Parallel Events**
> As a user, I want to tag timeline entries to indicate story loops (e.g., time travel), alternate universes, or parallel events, so I can filter and render timelines in different logical groupings.

## Acceptance Criteria
- [ ] User can assign tags to timeline entries (e.g., "Prime Timeline", "Alternate Timeline", "Time Loop", "Character A", "City X")
- [ ] Tags can be used to filter or group entries in the timeline view
- [ ] UI supports tag selection, creation, and removal for entries
- [ ] Tags are visible on timeline entries
- [ ] Timeline can be rendered by tag grouping (e.g., show only "Prime Timeline" or alternate arcs)
- [ ] Tags can be used for advanced rendering logic (e.g., alternating, grouped, or separated views)

## Technical Requirements
- Extend tag system to support timeline entry tags (not just media items)
- Update TimelineEntry model and UI for tag assignment
- Implement tag-based filtering and grouping in timeline view
- Add rendering logic for different tag-based views (universe order, binge order, etc.)
- Test tag assignment and filtering/grouping

## Priority
High – Enables advanced timeline logic for loops, universes, and parallel events

## Dependencies
- Story 09 (Tag Media Items)
- TimelineEntry data model
- Timeline view rendering logic
