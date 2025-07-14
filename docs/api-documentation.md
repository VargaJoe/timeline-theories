# API Documentation

This document provides an overview of the Timeline Theories API architecture and key services.

## Architecture Overview

Timeline Theories uses a hybrid architecture combining:
- **Frontend**: React SPA with TypeScript
- **Content Management**: SenseNet ECM for data storage
- **Authentication**: OIDC (OpenID Connect)
- **External APIs**: Trakt.tv integration via Netlify Functions

## Core Services

### Timeline Service (`timelineService.ts`)

Manages timeline CRUD operations through SenseNet ECM.

```typescript
interface TimelineCreateRequest {
  name: string;           // URL slug
  displayName: string;    // Human-readable title
  description?: string;   // Optional description
  sortOrder: 'chronological' | 'release';
}

// Create a new timeline
const timeline = await createTimeline(request: TimelineCreateRequest);

// Get timeline by name
const timeline = await getTimeline(name: string);

// List all timelines
const timelines = await listTimelines();
```

### Media Library Service (`mediaLibraryService.ts`)

Manages media items (films, books, TV shows, etc.) in the global library.

```typescript
interface MediaItemCreateRequest {
  DisplayName: string;      // Title, e.g., "Star Wars (1977)"
  Description: string;      // Plot summary or description
  MediaType: string;        // 'film', 'book', 'tv', 'comic', 'game'
  ReleaseDate?: string;     // ISO date string
  CoverImageUrl?: string;   // URL to cover art
  ExternalLinks?: string;   // JSON string of external links
}

// Create media item
const item = await MediaLibraryService.createMediaItem(request);

// Get all media items
const items = await MediaLibraryService.getMediaItems();
```

### Timeline Entry Service (`timelineEntryService.ts`)

Links media items to timelines with position and metadata.

```typescript
interface TimelineEntryCreateRequest {
  displayName: string;      // Entry display name
  mediaItem: {             // Reference to media item
    Name: string;
    Id: number;
    DisplayName: string;
    CoverImageUrl?: string;
  };
  timelineId: number;      // Timeline ID (for compatibility)
  position: number;        // Sort position in timeline
}

// Create timeline entry
const entry = await TimelineEntryService.createTimelineEntry(
  data: TimelineEntryCreateRequest,
  timelinePath: string
);

// List entries for timeline
const entries = await TimelineEntryService.listTimelineEntries(
  timelineId: number,
  timelinePath: string
);
```

### Trakt Service (`traktService.ts`)

Integrates with Trakt.tv API for importing lists and media data.

```typescript
interface TraktListItem {
  title: string;           // Media title
  year?: number;          // Release year
  type: 'movie' | 'show'; // Media type
  ids: {                  // External IDs
    trakt: number;
    imdb?: string;
    tmdb?: number;
  };
}

// Fetch Trakt list
const items = await fetchTraktList(
  username: string,
  listSlug: string
): Promise<TraktListItem[]>;
```

## Netlify Functions

### Trakt Proxy (`trakt-proxy.cjs`)

Proxies requests to Trakt.tv API to avoid CORS issues and protect API keys.

**Endpoint**: `/.netlify/functions/trakt-proxy`

**Parameters**:
- `username`: Trakt username
- `list`: List slug

**Response**: Array of Trakt list items

**Environment Variables Required**:
- `TRAKT_API_KEY`: Your Trakt.tv API key

## Content Types (SenseNet)

### Timeline
- **Path**: `/Root/Content/Timelines/{timeline-name}`
- **Fields**:
  - `DisplayName`: Human-readable title
  - `Description`: Optional description
  - `SortOrder`: 'chronological' or 'release'

### MediaItem
- **Path**: `/Root/Content/MediaLibrary/{item-name}`
- **Fields**:
  - `DisplayName`: Title with year, e.g., "Star Wars (1977)"
  - `Description`: Plot summary
  - `MediaType`: Category (film, book, tv, etc.)
  - `ReleaseDate`: ISO date string
  - `CoverImageUrl`: Cover art URL
  - `ExternalLinks`: JSON string of external links

### TimelineEntry
- **Path**: `/Root/Content/Timelines/{timeline}/TimelineEntries/{entry-name}`
- **Fields**:
  - `DisplayName`: Entry title
  - `MediaItem`: Reference to MediaItem
  - `Position`: Sort order
  - `EntryLabel`: Optional label ('main', 'flashback', etc.)
  - `Importance`: Priority level ('high', 'medium', 'low')

## Authentication

Timeline Theories uses OIDC for authentication. Configure these environment variables:

```env
VITE_OIDC_CLIENT_ID=your-client-id
VITE_OIDC_AUTHORITY=https://your-identity-server-url
```

The OIDC client automatically handles:
- User login/logout
- Token management
- Silent renewal
- SenseNet repository authentication

## Error Handling

All services implement consistent error handling:

```typescript
try {
  const result = await timelineService.createTimeline(data);
  // Handle success
} catch (error) {
  if (error instanceof Error) {
    console.error('Operation failed:', error.message);
    // Show user-friendly error message
  }
}
```

Common error scenarios:
- Network failures
- Authentication errors
- Validation failures
- Resource not found
- Permission denied

## Rate Limiting

- **Trakt API**: Respects Trakt.tv rate limits (1000 requests/5 minutes)
- **SenseNet**: No specific limits, but good practice to batch operations

## Development Notes

### Local Development
- Use development SenseNet repository
- Mock external API calls when possible
- Test with various data scenarios

### Production Considerations
- Configure proper CORS policies
- Use production SenseNet repository
- Monitor API usage and errors
- Implement proper caching strategies

For more detailed implementation examples, see the source code in the `client/services/` directory.
