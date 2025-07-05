# Story 04 - Reuse Media Item Multiple Times

## User Story
**US004 – Reuse Media Item Multiple Times**
> As a user, I want to use the same media item multiple times in a single timeline (e.g., if it appears in two story arcs), optionally with notes.

## Acceptance Criteria
- [ ] User can add the same media item multiple times to one timeline
- [ ] Each instance can have different position in timeline
- [ ] Each instance can have unique notes/labels
- [ ] User can differentiate between instances (e.g., "Alt. Timeline", "Flashback")
- [ ] Timeline view clearly shows multiple instances

## Technical Requirements
- Allow multiple timeline_entry records for same media_item
- Add repeat_label field to timeline entries
- Update UI to handle multiple instances
- Implement instance-specific note handling

## Priority
Medium - Enhances timeline flexibility

## Dependencies
- Story 03 (Add Existing Media Entry to Timeline)
- Timeline entry data model with repeat labels
