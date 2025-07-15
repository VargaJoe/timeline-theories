# Media Update Data Sources Configuration

The bulk update feature supports multiple data sources for fetching media information. Here's how to configure each source:

## Supported Sources (in order of preference)

### 1. OMDb API (Recommended for development)
- **Free tier**: 1,000 requests/day
- **Data**: IMDb data including titles, descriptions, cover images, release dates
- **Setup**: Get free API key from [OMDbAPI.com](http://www.omdbapi.com/)
- **Environment**: `VITE_OMDB_API_KEY=your-key-here`

### 2. TMDB (The Movie Database)
- **Free tier**: 1,000 requests/day per IP
- **Data**: Comprehensive movie/TV data with high-quality images
- **Setup**: Get free API key from [TMDB API Settings](https://www.themoviedb.org/settings/api)
- **Environment**: `VITE_TMDB_API_KEY=your-key-here`

### 3. IMDb (via OMDb)
- **Source**: Uses OMDb API for IMDb data
- **Automatic**: Works when media items have IMDb external links
- **Format**: `https://www.imdb.com/title/tt1234567/`

### 4. Trakt (Production only)
- **Limitation**: Only works in production due to CORS
- **Setup**: Already configured via Netlify proxy
- **Automatic**: Works when media items have Trakt external links

### 5. TVDB (Not yet implemented)
- **Status**: Placeholder - requires complex authentication
- **Future**: Could be added with API key management

## How the Update Process Works

1. **External Links First**: Checks if media item has external links (imdb, tmdb, tvdb, trakt)
2. **API Lookup**: Fetches data from the linked source using extracted IDs
3. **Search Fallback**: If no links, searches by title and year
4. **Multi-source**: Tries multiple sources until data is found

## Setting Up API Keys

### OMDb API (Easiest)
1. Visit [OMDbAPI.com](http://www.omdbapi.com/)
2. Click "API Key" tab
3. Choose "FREE!" plan (1,000 requests/day)
4. Enter email and get instant key
5. Add to `.env`: `VITE_OMDB_API_KEY=your-key`

### TMDB API
1. Create account at [TMDB](https://www.themoviedb.org/)
2. Go to Settings → API
3. Request API key (usually instant approval)
4. Add to `.env`: `VITE_TMDB_API_KEY=your-key`

## External Links Format

When creating media items, use these URL formats for external links:

```json
{
  "imdb": "https://www.imdb.com/title/tt0111161/",
  "tmdb": "https://www.themoviedb.org/movie/278",
  "trakt": "https://trakt.tv/movies/the-shawshank-redemption-1994"
}
```

## Supported Data Fields

The update feature can fetch and update:
- **Title**: Movie/show name
- **Description**: Plot summary/overview
- **Cover Image**: Poster URL
- **Release Date**: Release/air date
- **Runtime**: Duration in minutes
- **Genres**: Array of genre names

## Development vs Production

- **Development**: OMDb and TMDB work great for testing
- **Production**: All sources including Trakt via Netlify proxy
- **Fallback**: Always searches by title if external links fail

## Rate Limits

- **OMDb**: 1,000/day (free tier)
- **TMDB**: 1,000/day per IP (free tier)
- **Graceful Degradation**: Shows "No data found" if all sources fail

## Testing the Feature

1. Add API keys to your `.env` file
2. Create media items with external links
3. Use "Update Media Data" button on timeline page
4. Check browser console for detailed logging
5. Preview changes before applying
