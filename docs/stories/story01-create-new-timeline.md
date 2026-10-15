# Story 01 - Create New Timeline

> **Status audit — 2026-10-14:** Megvalósított; M0 UI/backend tesztelt. TimelineCreateForm + timelineService.createTimeline; default-private új timeline.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

## User Story
**US001 – Create New Timeline**
> As a user, I want to create a new timeline with a title, description, and sorting method (chronological or release order), so I can organize media items accordingly.

## Acceptance Criteria
- [ ] User can create a new timeline with a title
- [ ] User can add a description to the timeline
- [ ] User can select sorting method (chronological or release order)
- [ ] Timeline is saved to the database
- [ ] User is redirected to the timeline view after creation

## Technical Requirements
- Create timeline creation form
- Implement timeline data model
- Add validation for required fields
- Store timeline in database with proper relationships

## Priority
High - Core functionality for the application

## Dependencies
- User authentication system
- Database schema for timelines
- Basic UI components
