# Story 17 - Create Timeline by Trakt List

**As a user, I want to create a new timeline by importing a Trakt list, so I can quickly build timelines from my or others’ Trakt lists.**

## Technical Breakdown & Tasks
- Add "Import from Trakt List" option to Timeline Create Page.
- Allow user to enter a Trakt list URL or select from their lists.
- Fetch list items via Trakt API.
- For each item:
  - Check if media item exists; create if missing.
  - Create timeline entry for each item.
- Allow user to review and edit before finalizing the timeline.
