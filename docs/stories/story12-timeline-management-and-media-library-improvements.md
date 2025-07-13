# Story 12 - Timeline Management and Media Library Improvements

**As a user, I want to manage and organize my timelines and media library more efficiently, with features like drag-and-drop, grouping, and improved UI.**

## Technical Breakdown & Tasks
- Research and select drag-and-drop library (dnd-kit selected)
- Implement drag-and-drop functionality
- Add position field management
- Create manual position numbering
- Add grouping/arc functionality
- Implement date field for chronological sorting
- Add auto-save for position changes
- Update timeline display logic
- Test reordering functionality
- Fix timeline entry rearrange to only send updates for changed items
- Add reorder mode toggle and drag-and-drop support to TimelineViewPage.tsx using react-beautiful-dnd
- Add TimelineEntryService.updateEntryPositions for bulk position update
- TimelineEntry creation and navigation now use the correct Name/path segment for all timeline and entry URLs, ensuring friendly and consistent navigation
- Clean up and reorder implementation-tasks.md, mark completed tasks, fix order
- Add edit feature for timelines on entries page
- Add delete feature for timelines on entries page (with robust path handling in deleteTimeline)
