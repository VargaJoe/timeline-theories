# Implementation Tasks

This document tracks the progress of implementing the TimelineVerse application features. Tasks are organized by story and marked with checkboxes for completion tracking.

## Completed Stories
_No stories completed yet_

---

## In Progress Stories
- [x] Technical setup: Downgraded React and types to v17, installed @sensenet/authentication-oidc-react and @material-ui/core@4.12.4 for OIDC authentication (Story 08, Story 01)
- [x] Attempted OIDC/RepositoryContext integration, but reverted to JWT-based authentication and custom AuthContext due to compatibility and type issues (Story 08, Story 01)
- [x] Removed all sensenet/JWT logic. Switched to local mock authentication and local timeline creation. App is now backend-agnostic and ready for integration with PostgreSQL or any REST API (Story 08, Story 01)
- [x] Integrated with SenseNet repository for authentication and timeline storage. Timeline creation and listing now use SenseNet repository client and OIDC authentication (Story 08, Story 01)
- [x] TypeScript import/module resolution issues fixed for TimelineListPage. Type-only import used for Timeline type. AppProviders.tsx confirmed correct for OIDC context. (2025-07-09)
- [x] App starts and loads in browser using Vite. (2025-07-09)
- [ ] Test full login and timeline creation flow in the running app
- [ ] **NEW: Public timeline browsing and UI improvements** (High priority, branch: feature/public-timeline-browsing-and-ui-improvements, started 2025-07-07T19:22:22+02:00)
    - [ ] Allow unauthenticated users to browse timelines
    - [ ] Only require login for timeline creation or editing
    - [ ] Add a login button, do not auto-initiate login
    - [ ] Improve form and input styling for better UX
    - [ ] Fix error on timeline creation (investigate backend/frontend integration)
    - [ ] Fix error: Failed to load timelines (investigate backend API and integration)
    - [x] Add debug logging to LoginButton.tsx to inspect OIDC state and diagnose loading issue (2025-07-09)
    - [x] Add top-level console.log to LoginButton.tsx to confirm component rendering for OIDC debug (2025-07-09)
    - [x] Inject OIDC access token into repository client on login/logout (2025-07-09)
    - [x] Move OIDC token injection to OidcTokenInjector inside provider context (fixes useOidcAuthentication error) (2025-07-09)

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

### Story 01 - Create New Timeline (Priority: High)
**Dependencies**: Story 08 (User authentication)
- [ ] Design timeline database schema
- [ ] Create timeline data model
- [ ] Design timeline creation form UI
- [ ] Implement timeline creation form
- [ ] Add form validation for required fields
- [x] Implement timeline save functionality (SenseNet repository)
- [ ] Add timeline-user relationship
- [ ] Create timeline view redirect
- [ ] Test timeline creation flow

### Story 02 - Add Media Entry to Global Library (Priority: High)
**Dependencies**: Story 08 (User authentication)
- [ ] Design media_item database schema
- [ ] Create media_item data model
- [ ] Design media entry form UI
- [ ] Implement media type selection
- [ ] Add cover image upload/URL functionality
- [ ] Create external links input system
- [ ] Add description/notes field
- [ ] Implement media item save functionality
- [ ] Add media item validation
- [ ] Create media library view
- [ ] Test media item creation

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
