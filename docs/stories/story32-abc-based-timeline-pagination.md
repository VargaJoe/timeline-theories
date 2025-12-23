# Story 32 - ABC-based Timeline Pagination

## User Story
**US034 – ABC-based Timeline Pagination**
> As a user, I want to browse timelines efficiently using alphabetical pagination, so I can quickly find timelines by their starting letter without loading all timelines at once.

## Acceptance Criteria
- [x] **IMPLEMENTED: Character-based filtering** - Modified getTimelines() function to accept optional characterFilter parameter
- [x] **ENHANCED: SenseNet OData queries** - Added DisplayName filtering with wildcard patterns for alphabetic characters and regex for non-alphabetic (#)
- [x] **UPDATED: TimelineListPage component** - Added characterFilter state with default 'a' value and ABC navigation UI
- [x] **CREATED: ABC navigation controls** - Added character selection buttons (A-Z + # + All) at top and bottom of timeline list page
- [x] **IMPLEMENTED: Smart sorting logic** - Alphabetical sorting for character-filtered views, alphabetical + newest options for "All" view
- [x] **ENHANCED: UI feedback** - Active character button is highlighted with different styling and visual indicators
- [x] **MAINTAINED: Responsive design** - ABC navigation wraps properly on smaller screens and maintains accessibility
- [x] **ADDED: Configurable "All" view** - Environment variable VITE_ENABLE_ALL_TIMELINE_VIEW controls "All" button visibility (default: true)
- [x] **IMPLEMENTED: Pagination for "All" view** - Load more functionality with configurable page size (VITE_ALL_TIMELINE_PAGE_SIZE, default: 20)
- [x] **ENHANCED: Performance optimization** - Only "All" view uses pagination to avoid loading all timelines at once
- [x] **TESTED: Build verification** - All changes compile successfully with zero TypeScript errors
- [x] **RESULT: Improved user experience** - Users can browse timelines by starting character or view all with flexible sorting and pagination
- [x] **ENHANCED: "All" navigation option** - Added "All" button that shows all timelines without character filtering
- [x] **ENHANCED: Smart sorting logic** - Character-filtered views (A-Z, #) only allow alphabetical sorting, "All" view allows both alphabetical and newest-first sorting
- [x] **ENHANCED: Query handling** - Updated getTimelines() to properly handle empty characterFilter for "All" option
- [x] **ENHANCED: UI improvements** - Added "All" button to both top and bottom navigation with consistent styling
- [x] **TECHNICAL: Empty string bypass** - Empty string characterFilter bypasses server-side character filtering
- [x] **TECHNICAL: Adaptive sorting** - Client-side sorting logic adapts based on active filter (character vs all)
- [x] **TECHNICAL: Conditional UI** - "Newest First" option only appears in dropdown when "All" is selected
- [x] **TECHNICAL: Default behavior** - Maintains default 'a' character filter on page load as originally requested
- [x] **RESULT: Complete functionality** - ABC pagination fully functional with character filtering, "All" option provides access to all timelines with flexible sorting
- [x] **ENHANCED: Configurable pagination system** - Added environment variable configuration for "All" view with pagination support
- [x] **IMPLEMENTED: Load More functionality** - Added loading spinner and proper state management for incremental loading
- [x] **OPTIMIZED: Performance** - Character-filtered views load all at once, "All" view loads incrementally with skip/top parameters
- [x] **CONFIGURED: Feature toggling** - Configuration-based enable/disable for easy management via environment variables
- [x] **ADDED: Server-side sorting** - getTimelines() function now accepts sortOrder parameter for proper server-side ordering (CreationDate desc for newest, DisplayName for alphabetical)
- [x] **REMOVED: Client-side sorting** - Eliminated redundant client-side sorting since server handles ordering correctly across pagination

## Technical Requirements
- Modify getTimelines() function to accept optional characterFilter parameter
- Add SenseNet OData queries with DisplayName filtering using wildcard patterns
- Implement ABC navigation UI with character selection buttons (A-Z + # + All)
- Add pagination support for "All" view with configurable page size
- Implement server-side sorting with sortOrder parameter
- Add environment variable configuration for feature toggling
- Ensure responsive design and accessibility
- Maintain backward compatibility with existing timeline browsing

## Priority
Medium - UX improvement for timeline discovery

## Dependencies
- Existing timelineService.ts and TimelineListPage.tsx
- SenseNet OData query capabilities
- Environment variable configuration system