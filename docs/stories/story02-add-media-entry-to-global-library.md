# Story 02 - Add Media Entry to Global Library

## User Story
**US002 – Add Media Entry to Global Library**
> As a user, I want to add a media item with metadata (title, type, cover image, external links, description) to a global media library, so it can be reused across multiple timelines.

## Acceptance Criteria
- [ ] User can add a new media item with title
- [ ] User can select media type (film, episode, book, comic, etc.)
- [ ] User can upload or provide URL for cover image
- [ ] User can add external links (IMDb, Trakt, Goodreads, etc.)
- [ ] User can add description/notes
- [ ] Media item is saved to global library
- [ ] Media item can be searched and found by other users

## Technical Requirements
- Create media item form with all required fields
- Implement media_item data model
- Add image upload/URL handling
- Support for multiple external link types
- Validation for required fields

## Priority
High - Core functionality for media management

## Dependencies
- Database schema for media items
- Image storage solution
- Form validation components
