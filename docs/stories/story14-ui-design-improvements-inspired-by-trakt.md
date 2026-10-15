# Story 14 - UI/Design improvements inspired by Trakt

> **Status audit — 2026-10-14:** Megvalósított; teljes UX audit nélkül. TopNavigationBar, PageHeader, card/action layout létezik; minden mobil/accessibility kritérium nem frissen igazolt.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

**As a user, I want the app to have a modern, clean UI inspired by Trakt, making it easier and more enjoyable to use.**

## Technical Breakdown & Tasks
- Design and implement a top navigation bar with menu and user login/profile
- Add a banner/header row with site name and optional banner image
- Redesign timelines page:
    - Add controls row (Add Timeline/List, Reorder, etc.)
    - Display timelines as cards with cover images, title, short description, and action buttons
- Redesign timeline entries page:
    - Add timeline-specific banner (title, description, cover image)
    - Add controls row (Edit, Reorder, Share, etc.)
    - Display entries as cards with cover image, title, year/type, truncated description, and action buttons
- Apply consistent styling to match Trakt’s clean, modern look (spacing, card layout, icons, etc.)
