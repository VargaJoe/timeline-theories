# Story 31 - Optimize Media API Queries and Fix Lazy Loading Images

> **Status audit — 2026-10-14:** Részleges. Pagination, LazyImage concurrency/auth/anon/fallback van. Nincs react-window/virtualized MediaLibrary; image localStorage cache nincs; entry list minden 100-as lapot olvas, nem csak 50-et. Általános performance-célokhoz nincs mérési bizonyíték.
> See [the current source-backed status register](../feature-status-audit-2026-10-14.md). The criteria and historical checkboxes below describe the original scope; they are not fresh verification of every item.

## User Story
**US033 – Optimize Media API Queries and Fix Lazy Loading Images**
> As a user, I want media API queries to be efficient and lazy-loaded images to display reliably, so the app performs well and provides a smooth experience when browsing media.

## Acceptance Criteria
- [ ] Media API queries are optimized (e.g., reduced calls, caching, pagination) to improve load times
- [ ] Lazy loading images load correctly without errors or broken displays
- [ ] Performance metrics (e.g., query response time) meet acceptable thresholds
- [ ] No regressions in existing media browsing functionality

## Technical Requirements
- Implement query optimization (e.g., debouncing, batching) in media services
- Fix lazy loading component (e.g., `LazyImage.tsx`) for proper image rendering
- Add error handling and fallbacks for failed image loads
- Test with various media types and network conditions

## Priority
Medium - Performance and UX improvement

## Dependencies
- Existing media library and API services
- LazyImage component