# Story 22 - Bulk Update Media Details for Timeline Entries

**As a user, I want to bulk update missing or outdated media details for all entries in a timeline, so I can enhance incomplete media items with titles, descriptions, and cover images.**

## Problem Statement
Currently, some media items in timelines have missing titles, descriptions, or cover images. Users need an efficient way to update multiple media items at once rather than editing them one by one.

## User Story
- As a timeline owner, I want to see an "Update Media Data" button on the timeline page
- I want to choose what information to update (titles, descriptions, cover images)
- I want to preview changes before applying them
- I want to update only missing data, or optionally overwrite existing data
- I want to see progress during the bulk update process

## Acceptance Criteria
1. **Update Button**: Add "Update Media Data" button next to "Import from Trakt" on timeline view page
2. **Update Options**: User can select which fields to update:
   - Titles (for items with missing or empty titles)
   - Descriptions (for items with missing or empty descriptions)  
   - Cover Images (for items with missing cover images)
3. **Data Source**: Fetch updated data from Trakt API using existing media item external links or search
4. **Cover Image Handling**: 
   - Option 1: Store cover image URLs directly
   - Option 2: Download and store images as binary data in SenseNet
5. **Update Strategy**:
   - "Missing Only": Only update empty/null fields
   - "Overwrite All": Update all selected fields regardless of existing data
6. **Preview Changes**: Show a diff/preview of what will be updated before applying
7. **Progress Feedback**: Display progress bar/status during bulk update
8. **Error Handling**: Handle failed updates gracefully, show which items succeeded/failed

## Technical Breakdown & Tasks
- [ ] Create BulkUpdateDialog component for update options and preview
- [ ] Add "Update Media Data" button to TimelineViewPage next to Import button
- [ ] Implement MediaUpdateService for fetching updated data from Trakt
- [ ] Add preview/diff functionality to show changes before applying
- [ ] Implement bulk update with progress tracking
- [ ] Add error handling and success/failure reporting
- [ ] Support both URL-based and binary cover image storage
- [ ] Add user preference for missing-only vs overwrite-all strategy
- [ ] Test bulk update functionality with real timeline data

## Technical Implementation

### Multi-Source Data Fetching
The service now supports multiple data sources in order of preference:

1. **OMDb API** - Free IMDb data (1,000 requests/day)
2. **TMDB API** - Free movie database (1,000 requests/day)  
3. **IMDb URLs** - Via OMDb API when external links exist
4. **Trakt API** - Production only (via Netlify proxy)
5. **TVDB** - Placeholder for future implementation

### Smart Source Selection
- **External Links First**: Uses existing IMDb, TMDB, Trakt URLs from media items
- **Search Fallback**: Searches by title and year when no external links exist
- **Multi-source**: Tries multiple sources until data is found
- **Graceful Degradation**: Shows helpful error messages when all sources fail

### API Key Configuration
- **OMDb**: `VITE_OMDB_API_KEY` (get free key from omdbapi.com)
- **TMDB**: `VITE_TMDB_API_KEY` (get free key from themoviedb.org)
- **Development Ready**: Works immediately with free API keys
- **Production Ready**: Includes Trakt integration via existing Netlify proxy

## Design Notes
- Place button in the action bar next to other timeline management buttons
- Use modal dialog similar to TraktImportDialog for consistency
- Implement progressive enhancement - start with basic functionality, add advanced features
- Consider rate limiting for Trakt API calls during bulk operations
- Provide clear feedback about what changed and what failed
