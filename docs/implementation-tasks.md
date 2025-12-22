# Timeline Theories - Personal Multi-Media Timeline Tool

Timeline Theories is a personal application for creating, organizing, and sharing timeline lists for stories or universes of different media in chronological order, based on personal research and opinio

## In Progress


---

## Planned

### Story 30 - Book Reading Progress and Personal Library Integration
- [ ] Implement reading status tracking ("Want to Read", "Currently Reading", "Read", "Did Not Finish")
- [ ] Add personal rating system separate from general media ratings
- [ ] Create reading notes functionality separate from general timeline entry notes
- [ ] Add reading date tracking (when user read each book vs publication date)
- [ ] Implement reading progress statistics and analytics
- [ ] Create personal reading timeline views alongside publication order

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

### Technical Task - Fix Docker Compose Healthchecks for Local SenseNet Repository
- [ ] Restore appropriate healthchecks for SQL Server, Auth, and API services
- [ ] Ensure proper startup order with healthcheck conditions
- [ ] Test that containers start in correct sequence without manual intervention
- [ ] Verify that services are fully ready before depending services start

### Technical Task - Automate Development Certificate Generation in Docker Compose
- [ ] Implement certificate generation within Docker Compose (e.g., using OpenSSL in a init container)
- [ ] Ensure generated certificates are trusted on Windows host (import to trusted root store)
- [ ] Remove dependency on external scripts for certificate creation
- [ ] Test certificate auto-generation and trust setup
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

### Technical Task - Book Import Performance Optimization
- [ ] Implement pagination for book search results to handle large result sets
- [ ] Add debouncing to search input to reduce API calls during typing
- [ ] Cache recent search results to avoid duplicate API requests
- [ ] Optimize book import dialog loading states and error handling
- [ ] Add loading indicators for better user experience during searches

### Technical Task - Book Data Validation and Error Handling
- [ ] Add ISBN format validation (ISBN-10 and ISBN-13 support)
- [ ] Implement better error handling for failed API requests in book import
- [ ] Add validation for publication year ranges and required fields
- [ ] Improve duplicate detection accuracy (fuzzy matching for titles/authors)
- [ ] Add user feedback for import failures and partial successes

### Technical Task - Mobile Responsiveness for Book Features
- [ ] Optimize BookImportDialog layout for mobile devices
- [ ] Improve MediaItemEditDialog responsiveness on small screens
- [ ] Test book import and editing workflows on mobile browsers
- [ ] Adjust button sizes and spacing for touch interfaces
- [ ] Ensure book-specific fields display properly on mobile

### Technical Task - Book Series Metadata Enhancement
- [ ] Implement automatic series detection from imported book data
- [ ] Add series relationship management between books
- [ ] Create series overview pages showing all books in a series
- [ ] Add series completion tracking and progress indicators
- [ ] Implement series-based sorting and filtering options

### Story 31 - Optimize Media API Queries and Fix Lazy Loading Images
- [ ] Media API queries are optimized (e.g., reduced calls, caching, pagination) to improve load times
- [ ] Lazy loading images load correctly without errors or broken displays
- [ ] Performance metrics (e.g., query response time) meet acceptable thresholds
- [ ] No regressions in existing media browsing functionality
- [ ] Implement query optimization (e.g., debouncing, batching) in media services
- [ ] Fix lazy loading component (e.g., `LazyImage.tsx`) for proper image rendering
- [ ] Add error handling and fallbacks for failed image loads
- [ ] Test with various media types and network conditions

### Story 06 - Organize Timeline Entries
- [ ] User can drag and drop timeline entries to reorder them
- [ ] User can manually set position numbers for entries
- [ ] User can group entries by story arcs or themes
- [ ] User can set dates for entries (for chronological sorting)
- [ ] Changes are saved automatically
- [ ] Timeline view reflects the new order immediately
- [ ] Implement drag-and-drop functionality
- [ ] Add position field management
- [ ] Create grouping/arc functionality
- [ ] Add date field for chronological sorting
- [ ] Implement auto-save for position changes
- [ ] Update timeline display logic

### Story 26 - Timeline Entry Tagging for Loops, Universes, and Parallel Events
- [ ] User can assign tags to timeline entries (e.g., "Prime Timeline", "Alternate Timeline", "Time Loop", "Character A", "City X")
- [ ] Tags can be used to filter or group entries in the timeline view
- [ ] UI supports tag selection, creation, and removal for entries
- [ ] Tags are visible on timeline entries
- [ ] Timeline can be rendered by tag grouping (e.g., show only "Prime Timeline" or alternate arcs)
- [ ] Tags can be used for advanced rendering logic (e.g., alternating, grouped, or separated views)
- [ ] Extend tag system to support timeline entry tags (not just media items)
- [ ] Update TimelineEntry model and UI for tag assignment
- [ ] Implement tag-based filtering and grouping in timeline view
- [ ] Add rendering logic for different tag-based views (universe order, binge order, etc.)
- [ ] Test tag assignment and filtering/grouping

### Story 27 - Multi-Timeline Rendering and Viewing Modes
- [ ] User can select different timeline rendering modes
- [ ] Timeline entries from multiple timelines can be shown in a combined view
- [ ] UI allows switching between rendering modes
- [ ] Entries are grouped/alternated according to selected mode
- [ ] Tag and cross-reference logic is respected in rendering
- [ ] Implement rendering logic for each mode
- [ ] Update timeline view UI to allow mode selection
- [ ] Combine entries from multiple timelines as needed
- [ ] Respect tags and cross-references in rendering
- [ ] Test all rendering modes for correctness

### Story 29 - Publisher Series Import and Management
- [ ] Add timeline type option to mark as "Publisher Series" vs chronological timeline
- [ ] Enhance media item creation for books with book-specific metadata fields
- [ ] Implement default sort by publication date for publisher series
- [ ] Add bulk book import from publisher data sources (Open Library, Google Books)
- [ ] Create book-specific import workflows with appropriate field mapping
- [ ] Add series metadata inheritance to auto-fill publisher/series info for subsequent books
- [ ] Refactor content types for proper inheritance (Book inherits from MediaItem)
- [ ] Update media item creation forms with book-specific fields
- [ ] Implement bulk import services for book data sources
- [ ] Add timeline type selection and sorting logic

---

## Completed 

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
- [x] Comprehensive API rate limiting protection with graceful fallback
  - [x] Added RateLimitInfo and ApiError interfaces for proper error categorization
  - [x] Implemented exponential backoff retry logic (1s, 2s, 4s, 8s delays)
  - [x] Enhanced all API methods with rate limit detection and handling
  - [x] Added graceful fallback behavior - skips to next data source when rate limited
  - [x] Enhanced UI with real-time API status display and countdown timers
  - [x] Production-ready system that handles API limitations without complete failure
  - [x] Handles OMDb daily limits, TMDb 429 errors, and Trakt rate limits properly

### Technical Task - Various Fixes
- [x] import tv shows elements missing data
- [x] FIX: Robust genre filter and display in MediaLibraryPage.tsx

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
- [x] Redesign timeline entries page:
    - [x] Add timeline-specific banner (title, description, cover image)
    - [x] Add controls row (Edit, Reorder, Share, etc.)
    - [x] Display entries as cards with cover image, title, year/type, truncated description, and action buttons
- [x] Apply consistent styling to match Trakt’s clean, modern look (spacing, card layout, icons, etc.)

### Story 23 - UI/UX Improvements for Timeline Action Buttons
- [x] **UI Consistency**: Move "Import from Trakt" button to be grouped with other timeline action buttons
- [x] **Icon-Based Design**: All admin buttons now use intuitive icons with consistent styling
- [x] Enhanced TraktImportDialog with modern dropdown design and better positioning
- [x] Improved button text clarity and visual consistency
- [x] Maintained accessibility with proper icon usage and responsive design
- [ ] **Icon-Based Design**: Replace verbose text buttons with intuitive icons to reduce visual clutter:
  - [x] Edit Timeline: ✏️ or 🔧 icon
  - [x] Add Media Entry: ➕ icon 
  - [x] Import from Trakt: 📥 or 🔗 icon
  - [x] Reorder Entries: ↕️ or 🔀 icon
  - [x] Update Media Data: 🔄 or ⬆️ icon
  - [x] Delete Timeline: 🗑️ icon
- [x] Add tooltips to explain each icon's function
- [x] Maintain accessibility with proper ARIA labels
- [x] Design consistent button group styling
- [x] Test usability and ensure icons are intuitive

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

### Story 28 - Auto Media Item Creation in Timeline Entry Process
- [x] Enhanced TimelineEntryCreatePage with dual-mode interface (select existing vs create new)
- [x] Added mode toggle between 'select' and 'create' workflows  
- [x] Integrated MediaItemCreateForm component into timeline entry creation
- [x] Improved UI/UX with modern card-based design and clear workflows
- [x] Maintains backward compatibility with existing selection process
- [x] New media items are automatically selected after creation
- [x] Streamlined workflow reduces friction for adding new content
- [x] Feature complete and ready for production use
- [x] All functionality tested and documented

### Technical Task - Private Timeline Admin Access Control
- [x] **IMPLEMENTED: Admin-only access to private timelines** - Private timelines now filtered from public view
- [x] **ENHANCED: TimelineListPage filtering** - Added `.filter()` logic to exclude private timelines for non-admin users
- [x] **ENHANCED: TimelineViewPage access control** - Added authentication check for direct URL access to private timelines
- [x] **IMPROVED: Error messaging** - Clear "administrators only" message for unauthorized access attempts
- [x] **UPDATED: UI labels** - Changed "TEST" indicator to "PRIVATE" for better user understanding

### Technical Task - Admin-only Media Library Access
- [x] **IMPLEMENTED: Admin-only menu visibility** - Media Library menu item only appears for authenticated admin users
- [x] **IMPLEMENTED: Admin-only page access** - MediaLibraryPage redirects non-admin users to home page
- [x] **ENHANCED: Admin email configuration** - Added VITE_ADMIN_EMAILS environment variable for configurable admin access
- [x] **ADDED: Admin validation function** - Created isAdmin() helper function for consistent admin checking across components
- [x] **SECURED: Direct URL access protection** - Users cannot access media library by URL without admin privileges
- [x] **ENHANCED: SenseNet group membership check** - Added administrators group membership validation for admin access
- [x] **ADDED: IsVisible field handling** - Enhanced timeline loading to include privacy status
- [x] **MAINTAINED: Backward compatibility** - All existing public timeline functionality preserved

### Technical Task - DisplayName/Title/Year Handling
- [x] **COMPLETED: Year field separation** - Added dedicated Year field to MediaItem content type with validation (1800-2100 range)
- [x] **UPDATED: TypeScript interfaces** - Added Year field to MediaItem interface and all related service interfaces
- [x] **ENHANCED: UI displays** - Modified MediaLibraryPage and MediaItemViewPage to display Title + Year separately
- [x] **UPDATED: Creation forms** - Added Year input field to MediaItemCreateForm and MediaItemEditDialog
- [x] **ENHANCED: Import functionality** - Updated TraktImportDialog to populate Year field from Trakt API data
- [x] **COMPLETED: Bulk update service** - Added year extraction to all TMDB and OMDb API methods, updated analyzeChanges and processBulkUpdate for Year field handling
- [x] **TESTED: Build verification** - All changes compile successfully with zero errors
- [x] **VERIFIED: End-to-end functionality** - Year field properly populated from external APIs and displayed in UI

### Technical Task - Chronological Description and Timeline Entry Editing
- [x] **IMPLEMENTED: ChronologicalDescription field** - Added ShortText field to TimelineEntry content type for flexible chronology descriptions
- [x] **ENHANCED: TypeScript interfaces** - Updated TimelineEntry interface with chronologicalDescription field
- [x] **UPDATED: Timeline creation forms** - Added chronology fields to TimelineEntryCreatePage for new entries
- [x] **CREATED: Unified edit modal** - Built TimelineEntryEditModal with tabbed interface for entry data vs media item data
- [x] **INTEGRATED: Edit functionality** - Added edit buttons and modal integration to TimelineViewPage
- [x] **IMPLEMENTED: Image upload in individual editing** - Added cover image mode selection (URL vs Upload) to TimelineEntryEditModal
- [x] **ENHANCED: MediaLibraryService** - Added uploadMediaItemCoverImage method for individual item uploads
- [x] **FIXED: Save logic** - Updated handleSaveMedia to handle both URL and binary image uploads
- [x] **TESTED: Build verification** - All changes compile successfully with zero errors
- [x] **COMPLETED: Feature parity** - Individual editing now has same image upload capabilities as bulk operations

### Story 29 - Publisher Series Import and Management
- [x] Add timeline type option to mark as "Publisher Series" vs chronological timeline
- [x] Enhance media item creation for books with book-specific metadata fields:
    - [x] Author field (separate from generic metadata)
    - [x] Publisher field
    - [x] ISBN field
    - [x] Publication year vs story/setting year
    - [x] Book series number (if part of numbered series)
- [x] Implement default sort by publication date for publisher series
- [x] **Architecture Improvement**: Refactored content types for proper inheritance - Book content type now inherits from MediaItem base type
- [x] Add bulk book import from publisher data sources (Open Library, Google Books)
- [x] Create book-specific import workflows with appropriate field mapping
- [x] Add series metadata inheritance to auto-fill publisher/series info for subsequent books

### Story 29.1 - Media Item Edit Functionality
- [x] Add edit buttons to media item cards in MediaLibraryPage (admin-only access)
- [x] Create MediaItemEditDialog component with comprehensive form fields
- [x] Integrate edit dialog with MediaLibraryPage and handle save/update functionality
- [x] Fix SeriesName interface issue in MediaLibraryService for proper TypeScript support
- [x] Implement immediate UI updates after successful media item edits
- [x] Add proper event handling to prevent navigation when clicking edit buttons
- [x] Add book-specific fields (author, publisher, ISBN, publication year, series info) to edit dialog
- [x] Test the complete edit functionality with various media types and ensure data persistence

### Technical Task - Admin-only Media Library Access
- [x] **IMPLEMENTED: Admin-only visibility for Media Library menu** - Media Library link only appears for authenticated users
- [x] **UPDATED: TopNavigationBar component** - Added oidcUser conditional rendering for Media Library link
- [x] **UPDATED: Mobile navigation** - Applied same admin-only logic to mobile menu Media Library link
- [x] **MAINTAINED: Consistent behavior** - Admin access control matches other admin functions in the application
- [x] **ENHANCED: SenseNet group membership validation** - Added administrators group check with case-insensitive matching
- [x] **FIXED: Admin user special case** - Added special handling for 'Admin' user (Name/LoginName) to bypass group membership requirement
- [x] **MAINTAINED: Email fallback** - Preserved email-based admin validation for backward compatibility
- [x] **UPDATED: Admin function visibility** - Modified all admin function buttons (Add Media Item, Import Books, Edit) to use isAdmin(user) condition instead of just user existence
- [x] **FIXED: Auth loading timing** - Added isLoading check to admin access control useEffect to prevent premature redirects
- [x] **SYNCHRONIZED: isAdmin functions** - Updated TopNavigationBar isAdmin function to match MediaLibraryPage implementation with Admin user special case
- [x] **TESTED: Build verification** - All changes compile successfully with zero errors

### Technical Task - Maintenance Mode Implementation
- [x] **IMPLEMENTED: Environment variable-based maintenance mode** - VITE_MAINTENANCE_MODE environment variable controls site availability
- [x] **CREATED: MaintenanceMode component** - Professional maintenance page with clear messaging and visual design
- [x] **UPDATED: AppProviders component** - Added maintenance mode check before rendering main application
- [x] **ENHANCED: Error handling** - Graceful fallback when API is unavailable or security issues require quick shutdown
- [x] **TESTED: Build verification** - All changes compile successfully with zero errors
- [x] **DOCUMENTED: Usage** - Environment variable configuration documented for deployment scenarios

### Technical Task - Dual Authentication Support (OIDC/JWT)
- [x] **IMPLEMENTED: Environment-based auth switching** - VITE_AUTH_TYPE variable controls OIDC vs JWT mode selection
- [x] **ENHANCED: AppProviders conditional rendering** - AuthenticationProvider only rendered for OIDC mode
- [x] **FIXED: Safe hook usage in components** - Added try-catch blocks around useOidcAuthentication calls for JWT compatibility
- [x] **UPDATED: Key components** - TopNavigationBar, OidcTokenInjector, TimelineListPage updated for dual auth support
- [x] **TESTED: Build verification** - All changes compile successfully with zero TypeScript errors
- [x] **READY: Testing phase** - JWT authentication flow and user state management ready for testing in both modes

### Technical Task - Timeline Loading Optimization (Public/Private Access Control)
- [x] **IDENTIFIED: Performance issue** - Timeline list page was downloading all timelines (public + private) from API regardless of user authentication status
- [x] **ANALYZED: Network traffic** - User reported seeing all timeline elements downloaded in browser network tab even when not visible
- [x] **IMPLEMENTED: Server-side filtering** - Modified getTimelines() function to accept includePrivate parameter and filter at API level
- [x] **ENHANCED: Query logic** - Added `+IsVisible:true` condition to SenseNet OData query when includePrivate=false
- [x] **UPDATED: TimelineListPage** - Modified to pass user authentication status to getTimelines(!!user)
- [x] **MAINTAINED: Backward compatibility** - Default behavior (includePrivate=false) ensures public-only access for unauthenticated users
- [x] **TESTED: Build verification** - All changes compile successfully with zero TypeScript errors
- [x] **RESULT: Optimized network usage** - Unauthenticated users now only download public timelines, reducing unnecessary data transfer and improving performance

---
