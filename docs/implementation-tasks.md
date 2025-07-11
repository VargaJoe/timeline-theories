# Implementation Tasks

This document tracks the progress of implementing the TimelineVerse application features. Tasks are organized by story and marked with checkboxes for completion tracking.

## Completed Stories
- **Story 01 - Create New Timeline** ✅ COMPLETED (2025-07-11)
- **Story 02 - Add Media Entry to Global Library** ✅ COMPLETED (2025-01-22)

## In Progress Stories
- **Story 03 - Add Existing Media Entry to Timeline** 🎯 READY TO START (next priority)
- [x] Technical setup: Downgraded React and types to v17, installed @sensenet/authentication-oidc-react and @material-ui/core@4.12.4 for OIDC authentication (Story 08, Story 01)
- [x] Attempted OIDC/RepositoryContext integration, but reverted to JWT-based authentication and custom AuthContext due to compatibility and type issues (Story 08, Story 01)
- [x] Removed all sensenet/JWT logic. Switched to local mock authentication and local timeline creation. App is now backend-agnostic and ready for integration with PostgreSQL or any REST API (Story 08, Story 01)
- [x] Integrated with SenseNet repository for authentication and timeline storage. Timeline creation and listing now use SenseNet repository client and OIDC authentication (Story 08, Story 01)
- [x] TypeScript import/module resolution issues fixed for TimelineListPage. Type-only import used for Timeline type. AppProviders.tsx confirmed correct for OIDC context. (2025-07-09)
- [x] App starts and loads in browser using Vite. (2025-07-09)
- [x] **STORY 01 COMPLETED**: Create New Timeline feature fully implemented and tested (2025-07-11T10:52)
    - [x] Enhanced timelineService.ts with proper error handling, TypeScript types, and robust API calls
    - [x] Improved TimelineCreateForm.tsx with form validation, success messages, professional styling, and UX
    - [x] Updated TimelineViewPage.tsx to display complete timeline details with proper loading states and navigation
    - [x] Enhanced TimelineListPage.tsx with modern grid layout, better styling, and improved user experience
    - [x] All timeline CRUD operations working seamlessly with SenseNet backend
    - [x] Complete flow: Form validation → SenseNet API → Success feedback → Redirect to timeline view
    - [x] Timeline viewing and listing functionality fully operational
- [ ] **NEW: Public timeline browsing and UI improvements** (High priority, branch: feature/public-timeline-browsing-and-ui-improvements, started 2025-07-07T19:22:22+02:00)
    - [x] Allow unauthenticated users to browse timelines
    - [x] Only require login for timeline creation or editing
    - [x] Add a login button, do not auto-initiate login
    - [x] Improve form and input styling for better UX ✅ COMPLETED
    - [x] Fix error on timeline creation (investigate backend/frontend integration) ✅ COMPLETED
    - [x] Fix error: Failed to load timelines (investigate backend API and integration) ✅ COMPLETED
    - [x] Add debug logging to LoginButton.tsx to inspect OIDC state and diagnose loading issue (2025-07-09)
    - [x] Add top-level console.log to LoginButton.tsx to confirm component rendering for OIDC debug (2025-07-09)
    - [x] Inject OIDC access token into repository client on login/logout (2025-07-09)
    - [x] Move OIDC token injection to OidcTokenInjector inside provider context (fixes useOidcAuthentication error) (2025-07-09)
    - [x] **Successfully started client app** - Resolved dependency conflicts by downgrading React to v17.0.2 and installing @material-ui/core@4.12.4. App running on http://localhost:5173/ (2025-07-10T22:21)
    - [x] **Fixed OIDC login button loading issue** - Removed persistent loading state that prevented login button from showing. Login button now appears immediately and is clickable (2025-07-10T22:35)
    - [x] **Fixed logout navigation issue** - Implemented complete local logout to avoid external identity server redirect. Uses manual storage clearing and page refresh instead of OIDC redirect logout (2025-07-10T23:05)
    - [x] **SECURITY CLEANUP COMPLETED** - Removed all sensitive SenseNet OIDC credentials from GitHub by replacing hardcoded values in configuration.ts with environment variables. Created .env.example template and local .env file. Authentication guide updated with secure examples for AI agents (2025-07-10T23:15)
    - [ ] **LOGOUT TOKEN PERSISTENCE ISSUE** - After implementing logout token clearing fix, app still automatically logs in without re-authentication. Enhanced logout clears all OIDC storage keys and repository tokens, but cached authentication state persists somewhere. Root cause investigation needed for OIDC provider token caching or userManager state persistence (2025-07-10T23:31)
    - [ ] **IMPLEMENT SNBOOKING LOGOUT SOLUTION** - Found proven IdentityServer logout pattern in SNBooking repository (commit 40c23a5f78). Their working pattern: localStorage.clear() -> logout().then(() => sessionStorage.clear()). This approach clears tokens first, uses official logout flow, then clears session storage. Need to test this proven solution (2025-07-11T10:30)

---

## Planned Stories

### Story 08 - Register and Log In (Priority: High)
**Dependencies**: None - Foundation requirement
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

### Story 01 - Create New Timeline (Priority: High) ✅ COMPLETED
**Dependencies**: Story 08 (User authentication)
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

### Story 02 - Add Media Entry to Global Library (Priority: High) ✅ COMPLETED (2025-01-22)
**Dependencies**: Story 08 (User authentication)
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

### Story 03 - Add Existing Media Entry to Timeline (Priority: High)
**Dependencies**: Story 01, Story 02
- [ ] Design timeline_entry database schema
- [ ] Create timeline_entry data model
- [ ] Implement media search functionality
- [ ] Create media library browser UI
- [ ] Add media item selection interface
- [ ] Implement position assignment logic
- [ ] Add timeline-specific notes field
- [ ] Create timeline entry save functionality
- [ ] Update timeline view to show entries
- [ ] Test media addition to timeline

### Story 06 - Organize Timeline Entries (Priority: High)
**Dependencies**: Story 03
- [ ] Research and select drag-and-drop library
- [ ] Implement drag-and-drop functionality
- [ ] Add position field management
- [ ] Create manual position numbering
- [ ] Add grouping/arc functionality
- [ ] Implement date field for chronological sorting
- [ ] Add auto-save for position changes
- [ ] Update timeline display logic
- [ ] Test reordering functionality

### Story 07 - View and Share Timeline (Priority: High)
**Dependencies**: Story 01, Story 06
- [ ] Create timeline display component
- [ ] Implement sorting toggle (chronological/release)
- [ ] Add public sharing mechanism
- [ ] Create public timeline view (read-only)
- [ ] Implement sharing link generation
- [ ] Add privacy controls
- [ ] Create sharing link management
- [ ] Add timeline formatting preservation
- [ ] Test sharing functionality

### Story 05 - Link Media Items to External Sources (Priority: Medium)
**Dependencies**: Story 02
- [ ] Design external link data structure
- [ ] Create external link management system
- [ ] Implement link validation utilities
- [ ] Add media-type specific link suggestions
- [ ] Create external link UI components
- [ ] Add link icons and branding
- [ ] Implement link storage (JSON or separate table)
- [ ] Test external link functionality

### Story 04 - Reuse Media Item Multiple Times (Priority: Medium)
**Dependencies**: Story 03
- [ ] Update timeline_entry model for multiple instances
- [ ] Add repeat_label field to timeline entries
- [ ] Update UI to handle multiple instances
- [ ] Implement instance-specific note handling
- [ ] Update timeline view for multiple instances
- [ ] Add instance differentiation labels
- [ ] Test multiple instance functionality

### Story 09 - Tag Media Items (Priority: Medium)
**Dependencies**: Story 02
- [ ] Design tag database schema
- [ ] Create tag data model
- [ ] Implement tagging system
- [ ] Create tag management UI
- [ ] Add tag autocomplete functionality
- [ ] Implement tag-based search
- [ ] Create tag cloud/statistics view
- [ ] Add tag validation and cleanup
- [ ] Test tagging functionality

### Story 10 - Search and Filter Timelines (Priority: Medium)
**Dependencies**: Story 09
- [ ] Set up search infrastructure
- [ ] Implement full-text search functionality
- [ ] Create advanced filtering interface
- [ ] Add search result sorting options
- [ ] Implement search pagination
- [ ] Add search performance optimization
- [ ] Create search analytics
- [ ] Test search and filtering

### Story 11 - Clone or Fork Public Timelines (Priority: Low)
**Dependencies**: Story 07
- [ ] Implement timeline cloning functionality
- [ ] Create clone relationship tracking
- [ ] Add clone permission system
- [ ] Implement deep copy of timeline structure
- [ ] Add clone history and attribution
- [ ] Create clone management interface
- [ ] Test cloning functionality

---

## Notes
- Stories are ordered by suggested implementation priority
- High priority stories form the core MVP functionality
- Medium priority stories enhance user experience
- Low priority stories are nice-to-have features
- Dependencies should be completed before starting dependent stories
- Each task should be tested before marking as complete
