Timeline Theories is an application for creating, organizing, and sharing timeline lists for stories or universes of different media in chronological order.

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

## In Progress Stories

### Story 06 - Organize Timeline Entries
- [x] Research and select drag-and-drop library (dnd-kit selected)
- [ ] Implement drag-and-drop functionality
- [ ] Add position field management
- [ ] Create manual position numbering
- [ ] Add grouping/arc functionality
- [ ] Implement date field for chronological sorting
- [ ] Add auto-save for position changes
- [ ] Update timeline display logic
- [ ] Test reordering functionality
- [ ] Fix timeline entry rearrange to only send updates for changed items
- [x] Add reorder mode toggle and drag-and-drop support to TimelineViewPage.tsx using react-beautiful-dnd
- [x] Add TimelineEntryService.updateEntryPositions for bulk position update



### Story 12 - Timeline Management and Media Library Improvements
- [x] Clean up and reorder implementation-tasks.md, mark completed tasks, fix order
- [ ] Add edit feature for timelines on entries page
- [ ] Add delete feature for timelines on entries page
- [ ] Add grouping/folder view and flat view toggle to media library page
- [ ] Fix search on media library page (currently not working)
- [ ] Suggest and review more features for timeline pages (compare with other timeline apps)
- [x] Implement reorder mode UI and save logic (Save Order button, drag-and-drop rows)
- [x] Resolve all type and lint errors for new feature
- [x] Track feature on branch: feature/timeline-entries-reorder
- [x] Restrict admin features (Create Timeline, Add Media Entry, Reorder, Add Media Item) to logged-in users only (conditional rendering with useOidcAuthentication)

  ### Story 14 - UI/Design improvements inspired by Trakt
  - [ ] Design and implement a top navigation bar with menu and user login/profile
  - [ ] Add a banner/header row with site name and optional banner image
  - [ ] Redesign timelines page:
      - [ ] Add controls row (Add Timeline/List, Reorder, etc.)
      - [ ] Display timelines as cards with cover images, title, short description, and action buttons
  - [ ] Redesign timeline entries page:
      - [ ] Add timeline-specific banner (title, description, cover image)
      - [ ] Add controls row (Edit, Reorder, Share, etc.)
      - [ ] Display entries as cards with cover image, title, year/type, truncated description, and action buttons
  - [ ] Apply consistent styling to match Trakt’s clean, modern look (spacing, card layout, icons, etc.)

## Planned Stories

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
