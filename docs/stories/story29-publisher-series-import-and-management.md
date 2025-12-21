# Story 29 - Publisher Series Import and Management

## User Story
**US29 – Publisher Series Import and Management**
> As a user, I want to manage publisher series for books with proper metadata and import capabilities, so I can organize book timelines by publication order.

## Acceptance Criteria
- [ ] Add timeline type option to mark as "Publisher Series" vs chronological timeline
- [ ] Enhance media item creation for books with book-specific metadata fields
- [ ] Implement default sort by publication date for publisher series
- [ ] Add bulk book import from publisher data sources (Open Library, Google Books)
- [ ] Create book-specific import workflows with appropriate field mapping
- [ ] Add series metadata inheritance to auto-fill publisher/series info for subsequent books

## Technical Requirements
- Refactor content types for proper inheritance (Book inherits from MediaItem)
- Update media item creation forms with book-specific fields
- Implement bulk import services for book data sources
- Add timeline type selection and sorting logic

## Priority
Medium

## Dependencies
- Book content type
- Media library services
- External book API integrations