# Timeline Theories - Personal Multi-Media Timeline Tool

Timeline Theories is a personal application for creating, organizing, and sharing timeline lists for stories or universes of different media in chronological order, based on personal research and opinio

## Current Bugs & UX Issues

- [x] **Mobile: Timeline Cards Width Issue**
    - Timeline cards were wider than the header/page container causing horizontal overflow on mobile.
    - Fixed by reducing grid minmax from 340px to 300px and adding mobile CSS constraints.
    - Added timeline-list-grid CSS class for better mobile responsive targeting.
- [x] **Mobile: Header Structure Improvement**
    - Moved site title display to TopNavigationBar for consistent branding.
    - Set showSiteTitle={false} on all PageHeader instances to avoid redundant titles.
    - PageHeader now shows only page-specific titles and content under the main navigation.
- [x] **Media Update: TV Seasons/Episodes Failing**
    - Media update was failing for TV seasons because MediaType validation was missing 'show', 'season', 'episode' values.
    - Fixed by adding missing MediaType values to allowedMediaTypes array in MediaLibraryService.
    - Both createMediaItem and updateMediaItem functions updated for consistency.
    - Specialized TV content handling in MediaUpdateService now works properly.
- [ ] **Trakt Import: Series Episode Titles Missing**
    - When importing from Trakt, episode titles are not brought over for series.
- [ ] **DisplayName/Title/Year Handling**
    - DisplayName is not sufficient for titles. Name can use the current logic (title + year + season/episode info), but we need to separate year from title in a dedicated field.
    - Add a `title` field for all media contents.
    - Consider adding a `subtitle` or `episodeTitle` field for episodes or installments (subtitle is more general for movies, books, audio, etc).
- [ ] **Trakt Import: Media Library Subfolder Selection**
    - Imported media items always go under the main media library. There should be a select/create subfolder input in the import UI.
- [ ] **Performance: Resource Loading on Navigation**
    - Navigating away from a page (e.g., media library) while it is still loading causes slowness, likely due to unfinished resource downloads. Find a solution to cancel or deprioritize unnecessary requests.
- [ ] **Mobile: Media Item Layout**
    - On mobile, media item display is ugly. Media info should be placed under the cover image at mobile resolutions.
- [ ] **Bulk Update: Redundant API Requests**
    - When previewing changes in bulk update, if the user goes back and re-previews without changing options, the app calls the API again. Should cache and reuse previous responses if options are unchanged.
- [ ] **Media Cover: Upload Default**
    - Upload media should be the default selection for cover image, not external URL (to avoid using external resources).

---

## Completed Stories

### Story 01 - Create New Timeline
- [x] Design timeline database schema
- [x] Create timeline data model
- [x] Design timeline creation form UI
- [x] Implement timeline creation form
- [x] Add form validation for required fields
- [x] Implement timeline save functionality (SenseNet repository)
- [x] Add timeline-user relationship
- [x] Create timeline view redirect
- [x] Test timeline creation flow
- [x] Enhanced error handling and TypeScript types
- [x] Professional styling and UX improvements
- [x] Success feedback and proper navigation flow
- [x] Complete timeline viewing and listing functionality

### Story 02 - Add Media Entry to Global Library
- [x] Design media_item database schema (SenseNet Memo content type)
- [x] Create media_item data model (MediaItem interface)
- [x] Design media entry form UI (MediaItemCreateForm)
- [x] Implement media type selection (Films, TV, Books, Comics, Games, etc.)
- [x] Add cover image upload/URL functionality (CoverImageUrl field)
- [x] Create external links input system (JSON-based external links)
- [x] Add description/notes field (Description field)
- [x] Implement media item save functionality (MediaLibraryService.createMediaItem)
- [x] Add media item validation (comprehensive form validation)
- [x] Create media library view (MediaLibraryPage with search/filtering)
- [x] Test media item creation (working end-to-end)
- [x] Add media item detail view page (MediaItemViewPage)
- [x] Complete end-to-end testing (all functionality verified)
- [x] Fixed SenseNet API integration (repository.loadCollection pattern)
- [x] Fixed navigation routing for media item detail pages

### Story 03 - Add Existing Media Entry to Timeline
- [x] Design TimelineEntry content type schema (SenseNet XML)
- [x] Implement TimelineEntry data model and service (TypeScript)
- [x] Create TimelineEntries folder in repository
- [x] Implement TimelineEntry creation UI and integration
- [x] Query and validate allowed values for Choice fields (EntryLabel, Importance)
- [x] Create valid TimelineEntry sample contents in repository
- [x] Confirm end-to-end flow from frontend to repository
- [x] Document and update project memory with repository structure and allowed values
- [x] TimelineEntry creation uses the selected MediaItem's Name for its Name property, ensuring consistent and readable content naming and paths

### Story 12 - Timeline Management and Media Library Improvements
- [x] Research and select drag-and-drop library (dnd-kit selected)
- [x] Implement drag-and-drop functionality
- [x] Add position field management
- [x] Create manual position numbering
- [x] Add grouping/arc functionality
- [x] Implement date field for chronological sorting
- [x] Add auto-save for position changes
- [x] Update timeline display logic
- [x] Test reordering functionality
- [x] Fix timeline entry rearrange to only send updates for changed items
- [x] Add reorder mode toggle and drag-and-drop support to TimelineViewPage.tsx using react-beautiful-dnd
- [x] Add TimelineEntryService.updateEntryPositions for bulk position update
- [x] TimelineEntry creation and navigation now use the correct Name/path segment for all timeline and entry URLs, ensuring friendly and consistent navigation
- [x] Clean up and reorder implementation-tasks.md, mark completed tasks, fix order
- [x] Add edit feature for timelines on entries page
- [x] Add delete feature for timelines on entries page (with robust path handling in deleteTimeline)

### Story 17 - Create Timeline by my Trakt List
- [x] Add "Import from Trakt List" option to Timeline Create Page.
- [x] Allow user to enter a Trakt list URL or select from their lists.
- [x] Fetch list items via Trakt API.
- [x] For each item:
    - [x] Check if media item exists; create if missing. (Now uses 'title (year)' format for display name)
    - [x] Create timeline entry for each item. (Now uses 'title (year)' format for display name)
- [x] Allow user to review and edit before finalizing the timeline.
- [x] Implement Trakt API integration via Netlify function proxy (trakt-proxy.cjs)
- [x] Add comprehensive error handling and import summary feedback
- [x] Support both timeline creation with import and import to existing timelines
- [x] Test end-to-end functionality with real Trakt lists
- [x] **FIX: Prevent duplicate timeline creation by adding fetchOnly mode to TraktImportDialog**
- [x] **FIX: Restore user-preferred review functionality for examining items before import**
- [x] **FIX: Consistent media item naming using 'title (year)' format for deduplication**
- [x] **FIX: Correct timeline path usage for consistent content creation**

### Technical Task - Robust Scroll Restoration for SPA
- [x] Integrate delayed-scroll-restoration-polyfill via CDN in index.html
- [x] Set window.history.scrollRestoration = 'manual' in App.tsx
- [x] Confirm robust scroll restoration on browser navigation (back/forward)
- [x] Ensure scroll position resets to top on new page navigation (except for back/forward)
- [x] Commit working solution and update project memory

### Technical Task - Fix Trakt Import Issues
- [x] **FIX: Duplicate import buttons** - Removed duplicate import logic from TimelineCreateForm
- [x] **FIX: Duplicate timeline creation** - TraktImportDialog + TimelineCreateForm both creating timelines
- [x] **FIX: Missing review functionality** - Users couldn't examine/edit items before import
- [x] **FIX: Inconsistent media naming** - Different 'title (year)' formats causing deduplication issues
- [x] **FIX: Wrong timeline paths** - Hardcoded paths vs projectPaths constants
- [x] **FIX: Navigation to wrong timeline** - Created 'Timeline' and 'Timeline (1)', navigated to empty one
- [x] Add fetchOnly mode to TraktImportDialog for fetch-then-review workflow
- [x] Consistent button text and UX for different import modes

### Story 22 - Bulk Update Media Details for Timeline Entries
- [x] Create BulkUpdateDialog component for update options and preview
- [x] Add "Update Media Data" button to TimelineViewPage next to Import button
- [x] Implement MediaUpdateService for fetching updated data from multiple sources
- [x] Add preview/diff functionality to show changes before applying
- [x] Implement bulk update with progress tracking
- [x] Add error handling and success/failure reporting
- [x] Add user preference for missing-only vs overwrite-all strategy
- [x] Implement multi-source data fetching (OMDb, TMDB, Trakt)
- [x] Add smart source selection and external link parsing
- [x] Create comprehensive API key configuration guide
- [x] **FIXED: Critical data structure corruption in MediaLibraryService.updateMediaItem()**
- [x] **FIXED: Content validation to detect incorrect external IDs pointing to wrong content**
- [x] **FIXED: Enhanced fallback logic: external IDs → title search → base series search**
- [x] **FIXED: || vs !== undefined logic preventing falsy value updates**
- [x] Comprehensive logging and debugging for troubleshooting update issues
- [x] Test bulk update functionality with real timeline data and verify changes persist
- [x] **IMPLEMENTED: Comprehensive API rate limiting protection with graceful fallback**
  - [x] Added RateLimitInfo and ApiError interfaces for proper error categorization
  - [x] Implemented exponential backoff retry logic (1s, 2s, 4s, 8s delays)
  - [x] Enhanced all API methods with rate limit detection and handling
  - [x] Added graceful fallback behavior - skips to next data source when rate limited
  - [x] Enhanced UI with real-time API status display and countdown timers
  - [x] Production-ready system that handles API limitations without complete failure
  - [x] Handles OMDb daily limits, TMDb 429 errors, and Trakt rate limits properly

### Technical Task - Various Fixes
- [x] import tv shows elements missing data
- [x] **FIX: Robust genre filter and display in MediaLibraryPage.tsx** - Added normalizeGenre function to handle both array and string values for item.Genre, mirroring MediaType handling. Prevents crash when filtering or displaying genre if data shape varies.

### Technical Task - Fix TV Show Import Naming
- [x] Fix TV show import to handle different media types properly
- [x] For whole shows: use format "show title (year)" (e.g., "Breaking Bad (2008)")
- [x] For seasons: use format "show title (year) Season X" (e.g., "Breaking Bad (2008) Season 5")
- [x] For episodes: use format "show title (year) SXXeXX" (e.g., ":DRYVRS (2015) S01E05")
- [x] Update TraktService to extract show information from season/episode objects
- [x] Update TraktImportDialog to use appropriate naming conventions
- [x] Test with real Trakt data containing shows, seasons, and episodes

### Story 14 - UI/Design improvements inspired by Trakt
- [x] Design and implement a top navigation bar with menu and user login/profile
- [x] Add a banner/header row with site name and optional banner image
- [x] Redesign timelines page:
    - [x] Add controls row (Add Timeline/List, Reorder, etc.)
    - [x] Display timelines as cards with cover images, title, short description, and action buttons
- [x] Apply consistent styling to match Trakt's clean, modern look (spacing, card layout, icons, etc.)
- [x] Enhanced TopNavigationBar component with user profile and modern navigation
- [x] Created PageHeader component for consistent page banners
- [x] Implemented card-based grid layout with hover effects and improved typography
- [x] Added cover image placeholders and visual hierarchy improvements
- [ ] Redesign timeline entries page:
    - [ ] Add timeline-specific banner (title, description, cover image)
    - [ ] Add controls row (Edit, Reorder, Share, etc.)
    - [ ] Display entries as cards with cover image, title, year/type, truncated description, and action buttons
- [ ] Apply consistent styling to match Trakt’s clean, modern look (spacing, card layout, icons, etc.)

### Story 23 - UI/UX Improvements for Timeline Action Buttons
- [x] **UI Consistency**: Move "Import from Trakt" button to be grouped with other timeline action buttons
- [x] **Icon-Based Design**: All admin buttons now use intuitive icons with consistent styling
- [x] Enhanced TraktImportDialog with modern dropdown design and better positioning
- [x] Improved button text clarity and visual consistency
- [x] Maintained accessibility with proper icon usage and responsive design
- [ ] **Icon-Based Design**: Replace verbose text buttons with intuitive icons to reduce visual clutter:
  - [ ] Edit Timeline: ✏️ or 🔧 icon
  - [ ] Add Media Entry: ➕ icon 
  - [ ] Import from Trakt: 📥 or 🔗 icon
  - [ ] Reorder Entries: ↕️ or 🔀 icon
  - [ ] Update Media Data: 🔄 or ⬆️ icon
  - [ ] Delete Timeline: 🗑️ icon
- [ ] Add tooltips to explain each icon's function
- [ ] Maintain accessibility with proper ARIA labels
- [ ] Design consistent button group styling
- [ ] Test usability and ensure icons are intuitive

### Technical Task - Timeline Fixes

- [x] There should be an option to delete a timeline entry from the timeline page when an administrator is logged in.
- [x] The delete timeline icon has disappeared from the timeline page; it was present before.
- [x] HTML support for the timeline description editor has disappeared; it was previously available. 
- [x] Timeline cards on the timelines page now show a “TEST” indicator if the timeline is not public.

### Technical Task - Fix Media Update Service for TV Content
- [x] **FIXED: Media updates only working for movies** - Enhanced MediaUpdateService to properly handle TV series, seasons, and episodes
- [x] **FIXED: Media type recognition** - Added support for recognizing 'show', 'season', 'episode' media types from Trakt
- [x] **FIXED: TMDB API endpoints** - Added specialized endpoints for seasons (/tv/{id}/season/{num}) and episodes (/tv/{id}/season/{num}/episode/{num})
- [x] **FIXED: Season/episode number extraction** - Added logic to extract season and episode numbers from display names
- [x] **FIXED: OMDb media type mapping** - Improved TV content type handling for OMDb API calls
- [x] **FIXED: Content type schema** - Added 'tvseason', 'show', 'season', 'episode' options to MediaItem content type
- [x] **FIXED: Fallback behavior** - Added fallback to series data when specific episode/season endpoints fail
- [x] Test bulk media updates for TV series, seasons, and episodes

---

## In Progress Stories

-- no stories in progress yet --

---

## Planned Stories

### Story 15 - Create Media Item by Trakt
- [ ] Add a "Search Trakt" button or field to the Media Item Create Page.
- [ ] Integrate Trakt API search endpoints for movies and shows.
- [ ] Display search results with key info (title, year, poster).
- [ ] On selection, auto-fill the media item form with Trakt data.
- [ ] Allow user to edit imported details before saving.
- [ ] Save Trakt IDs with the media item for future reference.

### Story 16 - Create Timeline Entry by Trakt
- [ ] Add a "Search Trakt" option to the Timeline Entry Create Page.
- [ ] Integrate Trakt API search for movies, shows, and episodes.
- [ ] On selection, check if the media item exists; if not, create it using Trakt data.
- [ ] Auto-fill timeline entry fields (title, date, etc.) with Trakt info.
- [ ] Allow user to edit before saving.
- [ ] Link the entry to the imported media item.

### Story 18 - Import Ratings from Trakt
- [ ] Add "Import Ratings from Trakt" option in user settings or media library.
- [ ] Fetch user ratings via Trakt API.
- [ ] Update or annotate media items with imported ratings.
- [ ] Optionally, display ratings in timelines and media item views.

### Story 19 - Search and Discover New Media for Timelines
- [ ] Add "Search Trakt" feature to main page or timeline management.
- [ ] Search Trakt for movies/shows.
- [ ] Indicate if the media is already in any timeline or synced list.
- [ ] Provide option to add missing media to a timeline or list.

### Story 21 - Manually Enrich Media Details from Trakt
- [ ] Add "Update from Trakt" button to media item detail page.
- [ ] Fetch latest details for the media item from Trakt using its ID.
- [ ] Show a diff/preview of changes before applying.
- [ ] Update media item with selected new data.

### Story 20 - Suggest Timelines by Trending/Popular Media
- [ ] Fetch trending/popular movies and shows from Trakt API.
- [ ] Match these with existing timelines in the app.
- [ ] Display suggested timelines on the main page, highlighting those related to trending media.


### Story 07 - View and Share Timeline
- [ ] Create timeline display component
- [ ] Implement sorting toggle (chronological/release)
- [ ] Add public sharing mechanism
- [ ] Create public timeline view (read-only)
- [ ] Implement sharing link generation
- [ ] Add privacy controls
- [ ] Create sharing link management
- [ ] Add timeline formatting preservation
- [ ] Test sharing functionality

### Story 08 - Register and Log In
- [ ] Set up authentication provider (Supabase Auth or Clerk)
- [ ] Design user database schema
- [ ] Create registration form component
- [ ] Create login form component
- [ ] Implement email/password authentication
- [ ] Add Google social login
- [ ] Add GitHub social login
- [ ] Implement session management
- [ ] Add password reset functionality
- [ ] Create user profile management
- [ ] Add logout functionality
- [ ] Test authentication flow

### Story 04 - Reuse Media Item Multiple Times
- [ ] Update timeline_entry model for multiple instances
- [ ] Add repeat_label field to timeline entries
- [ ] Update UI to handle multiple instances
- [ ] Implement instance-specific note handling
- [ ] Update timeline view for multiple instances
- [ ] Add instance differentiation labels
- [ ] Test multiple instance functionality

### Story 05 - Link Media Items to External Sources
- [ ] Design external link data structure
- [ ] Create external link management system
- [ ] Implement link validation utilities
- [ ] Add media-type specific link suggestions
- [ ] Create external link UI components
- [ ] Add link icons and branding
- [ ] Implement link storage (JSON or separate table)
- [ ] Test external link functionality

### Story 09 - Tag Media Items
- [ ] Design tag database schema
- [ ] Create tag data model
- [ ] Implement tagging system
- [ ] Create tag management UI
- [ ] Add tag autocomplete functionality
- [ ] Implement tag-based search
- [ ] Create tag cloud/statistics view
- [ ] Add tag validation and cleanup
- [ ] Test tagging functionality

### Story 10 - Search and Filter Timelines
- [ ] Set up search infrastructure
- [ ] Implement full-text search functionality
- [ ] Create advanced filtering interface
- [ ] Add search result sorting options
- [ ] Implement search pagination
- [ ] Add search performance optimization
- [ ] Create search analytics
- [ ] Test search and filtering

### Story 11 - Clone or Fork Public Timelines
- [ ] Implement timeline cloning functionality
- [ ] Create clone relationship tracking
- [ ] Add clone permission system
- [ ] Implement deep copy of timeline structure
- [ ] Add clone history and attribution
- [ ] Create clone management interface
- [ ] Test cloning functionality

### Story 13 - Timeline/List Migration from Other Apps
- [ ] Research popular timeline/list feature apps (Trakt, IMDb, etc.)
- [ ] Investigate if public or free APIs are available for data export
- [ ] If no API, research HTML parsing/scraping approaches
- [ ] Design migration/import workflow for supported sources
- [ ] Implement migration tool for at least one source (API or HTML)
- [ ] Add UI for importing timelines/lists from other apps
- [ ] Test migration with real-world data

### Story 24 - Enhanced Multi-Source Data Merging
- [ ] Add "Smart Merge" option for bulk updates that combines data from multiple sources
- [ ] Implement intelligent field selection (e.g., title from OMDb, cover image from TMDB, description from best source)
- [ ] Add user preference for automatic vs manual field selection during merge
- [ ] Create preview showing which fields come from which sources
- [ ] Allow users to override automatic field selection choices
- [ ] Add conflict resolution when sources provide different data for same field

### Story 25 - Timeline Entry Cross-References (Multi-Timeline Linking)
- [ ] Add multi-reference field to TimelineEntry model
- [ ] Update TimelineEntry creation/edit UI to support cross-references
- [ ] Display cross-reference links in timeline entry view
- [ ] Implement navigation between cross-referenced entries
- [ ] Ensure bidirectional reference visibility
- [ ] Test cross-reference creation and navigation

### Story 26 - Timeline Entry Tagging for Loops, Universes, and Parallel Events
- [ ] Extend tag system to support timeline entry tags (not just media items)
- [ ] Update TimelineEntry model and UI for tag assignment
- [ ] Implement tag-based filtering and grouping in timeline view
- [ ] Add rendering logic for different tag-based views (universe order, binge order, etc.)
- [ ] Test tag assignment and filtering/grouping

### Story 27 - Multi-Timeline Rendering and Viewing Modes
- [ ] Implement rendering logic for each mode (universe order, universe date order, binge order)
- [ ] Update timeline view UI to allow mode selection
- [ ] Combine entries from multiple timelines as needed
- [ ] Respect tags and cross-references in rendering
- [ ] Test all rendering modes for correctness