# Content Types Specification

This document defines the content type architecture for the TimelineVerse application.

## Overview

The timeline system uses a **three-content-type architecture** that provides proper normalization and supports all user stories:

1. **Timeline** - Container for timeline metadata
2. **MediaItem** - Global library of media entries  
3. **TimelineEntry** - Junction connecting media items to timelines

---

## 1. Timeline (Container)

**Current Implementation**: Using SenseNet `Memo` content type
**Future**: Custom `Timeline` content type

### Current Fields (Memo)
```typescript
{
  DisplayName: string     // Timeline title
  Description: string     // Timeline description  
  SortOrder: string      // "chronological" or "release"
  CreationDate: string   // Auto-generated
  CreatedBy: User        // Auto-generated
}
```

### Planned Enhanced Timeline Content Type
```typescript
Timeline {
  DisplayName: ShortText           // Timeline title
  Description: RichText            // Timeline description
  SortOrder: Choice               // Values: "Chronological", "Release"
  IsPublic: Boolean               // Public sharing (default: false)
  Category: Choice                // Values: "SciFi", "Fantasy", "Historical", "Horror", "Action", "Drama", "Comedy", "Documentary", "Other"
  CoverImageUrl: ShortText        // Cover image URL
  Tags: ShortText                 // Comma-separated tags
  ViewCount: Integer              // View statistics (default: 0)
  LikeCount: Integer              // Like count (default: 0)
  CreatedBy: Reference            // User who created it (auto-filled)
}
```

### Storage Location
- Current: `/Root/Content/SampleTimelines/`
- Future: `/Root/Content/Timelines/`

---

## 2. MediaItem (Global Library)

**Implementation Status**: To be created for Story 02
**Content Type**: Custom `MediaItem`

### Fields Specification
```typescript
MediaItem {
  DisplayName: ShortText          // Media title (e.g., "The Empire Strikes Back")
  Description: RichText           // Detailed description/synopsis
  MediaType: Choice               // Values: "Movie", "TVEpisode", "TVSeries", "Book", "Comic", "VideoGame", "Podcast", "Documentary", "Other"
  ReleaseDate: DateTime           // Official release date
  ChronologicalDate: DateTime     // In-universe date (optional)
  CoverImageUrl: ShortText        // Cover/poster image URL
  Duration: Integer               // Duration in minutes (optional)
  Genre: Choice                   // Values: "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", "Mystery", "Romance", "SciFi", "Thriller", "Documentary", "Other"
  Rating: Number                  // User rating 1-10 (optional)
  ExternalLinks: LongText         // JSON: {"imdb": "url", "wikipedia": "url", "wiki": "url"}
  Tags: ShortText                 // Comma-separated tags
  CreatedBy: Reference            // User who added it (auto-filled)
}
```

### Storage Location
- `/Root/Content/MediaLibrary/`

### Examples
```json
{
  "DisplayName": "The Empire Strikes Back",
  "Description": "The Rebel Alliance makes a daring assault on the Death Star...",
  "MediaType": "Movie",
  "ReleaseDate": "1980-05-21T00:00:00Z",
  "ChronologicalDate": "3 ABY",
  "Genre": "SciFi",
  "Duration": 124,
  "ExternalLinks": "{\"imdb\": \"https://www.imdb.com/title/tt0080684/\", \"wiki\": \"https://starwars.fandom.com/wiki/Star_Wars:_Episode_V_The_Empire_Strikes_Back\"}"
}
```

---

## 3. TimelineEntry (Junction/Association)

**Implementation Status**: To be created for Story 03
**Content Type**: Custom `TimelineEntry`

### Fields Specification
```typescript
TimelineEntry {
  DisplayName: ShortText          // Auto-generated: "{MediaItem} in {Timeline}"
  MediaItemId: Integer            // Reference to MediaItem ID
  TimelineId: Integer             // Reference to Timeline ID
  Position: Integer               // Manual sort position
  ChronologicalDate: DateTime     // In-universe date for chronological sorting
  ReleaseOrderPosition: Integer   // Position in release order
  Notes: RichText                 // Timeline-specific notes
  EntryLabel: ShortText           // Values: "First appearance", "Main story", "Flashback", "Cameo", "Reference", "Other"
  IsOptional: Boolean             // Mark as optional viewing/reading (default: false)
  ArcGroup: ShortText             // Story arc grouping (e.g., "Clone Wars", "Original Trilogy")
  Importance: Choice              // Values: "Essential", "Important", "Optional", "SkipOk"
  CreatedBy: Reference            // User who added this entry (auto-filled)
}
```

### Storage Location
- `/Root/Content/TimelineEntries/`

### Example
```json
{
  "DisplayName": "The Empire Strikes Back in Complete Star Wars Timeline",
  "MediaItemId": 1234,
  "TimelineId": 5678,
  "Position": 5,
  "ChronologicalDate": "3 ABY",
  "ReleaseOrderPosition": 2,
  "Notes": "Second film in original trilogy. Major character revelations.",
  "EntryLabel": "Main story",
  "IsOptional": false,
  "ArcGroup": "Original Trilogy",
  "Importance": "Essential"
}
```

---

## Relationships

```
Timeline (1) ──────── (N) TimelineEntry
                           │
MediaItem (1) ──────── (N) TimelineEntry

User (1) ────── (N) Timeline
User (1) ────── (N) MediaItem
User (1) ────── (N) TimelineEntry
```

### Key Benefits
- **No Duplication**: Media items stored once, reused across multiple timelines
- **Flexibility**: Same media can have different metadata per timeline
- **Story Support**: Supports reuse (Story 04), external links (Story 05), organization (Story 06)

---

## Implementation Phases

### ✅ Phase 1: Timeline Containers (Complete)
- [x] Timeline creation using Memo type
- [x] Timeline viewing and listing
- [x] Basic timeline metadata

### 🎬 Phase 2: Global Media Library (Story 02 - Next)
- [ ] Create MediaItem content type in SenseNet
- [ ] Build media item creation form
- [ ] Build media library browser
- [ ] Media item search and filtering

### 🔗 Phase 3: Timeline Entries (Story 03)
- [ ] Create TimelineEntry content type in SenseNet
- [ ] Build interface to add media items to timelines
- [ ] Display timeline entries in timeline view
- [ ] Timeline entry management (edit, remove, reorder)

### 🚀 Phase 4: Advanced Features
- [ ] External links management (Story 05)
- [ ] Drag-and-drop organization (Story 06)
- [ ] Enhanced timeline type migration from Memo
- [ ] Social features (likes, views, sharing)
- [ ] Public timeline browsing improvements

---

## Technical Notes

### SenseNet Content Type Creation
Content types will be created using SenseNet's content type definition system or through the admin interface.

### API Integration
Each content type will have corresponding TypeScript interfaces and service methods in the frontend application.

### Data Migration
When migrating from Memo to custom Timeline type:
1. Export existing timeline data
2. Create new Timeline content type
3. Import data with field mapping
4. Update frontend services
5. Remove old Memo-based timelines

---

## User Story Mapping

| User Story | Content Types Used | Implementation Phase |
|------------|-------------------|---------------------|
| Story 01: Create Timeline | Timeline (Memo) | ✅ Complete |
| Story 02: Add Media to Library | MediaItem | Phase 2 |
| Story 03: Add Media to Timeline | MediaItem + TimelineEntry | Phase 3 |
| Story 04: Reuse Media Items | MediaItem + TimelineEntry | Phase 3 |
| Story 05: External Links | MediaItem.ExternalLinks | Phase 4 |
| Story 06: Organize Entries | TimelineEntry.Position, ArcGroup | Phase 4 |
| Story 07: View and Share | Timeline.IsPublic | Phase 4 |
| Story 08: Authentication | User (existing) | ✅ Complete |
| Story 09: Tag Media | MediaItem.Tags, Timeline.Tags | Phase 4 |
| Story 10: Search and Filter | All types | Phase 4 |
| Story 11: Clone Timelines | Timeline + TimelineEntry | Phase 4 |

---

*Last Updated: 2025-07-11*
*Version: 1.0*
