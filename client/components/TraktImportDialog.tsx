import React, { useState } from 'react';
import type { TraktListItem } from '../services/traktService';
import { fetchTraktList } from '../services/traktService';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import MediaLibraryService from '../services/mediaLibraryService';
import type { MediaItem } from '../services/mediaLibraryService';
import type { TimelineEntry } from '../services/timelineEntryService';
import { timelinesPath } from '../projectPaths';
import { TimelineEntryService } from '../services/timelineEntryService';

interface TraktImportDialogProps {
  timelineName?: string;
  onTimelineCreated?: (timelineName: string) => void;
  onImportComplete?: (summary: string | TraktListItem[]) => void;
  createTimelineIfMissing?: (displayName: string, description: string) => Promise<string>;
  disabled?: boolean;
  fetchOnly?: boolean; // New prop: if true, only fetch items and return them without importing
}

export const TraktImportDialog: React.FC<TraktImportDialogProps> = ({
  timelineName,
  onTimelineCreated,
  onImportComplete,
  createTimelineIfMissing,
  disabled,
  fetchOnly = false
}) => {
  const [show, setShow] = useState(false);
  const [traktUrl, setTraktUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<string|null>(null);

  const { oidcUser } = useOidcAuthentication();

  const parseTraktUrl = (url: string) => {
    try {
      const m = url.match(/trakt.tv\/users\/([^/]+)\/lists\/([^/?#]+)/i);
      if (!m) return null;
      return { username: m[1], list: m[2] };
    } catch { return null; }
  };

  const extractTitleAndSubtitle = (item: TraktListItem) => {
    // Extract clean title from formatted display name
    // Examples:
    // "Movie Title (2020)" -> Title: "Movie Title", Subtitle: undefined
    // "Show Title (2020) Season 1" -> Title: "Show Title", Subtitle: "Season 1"
    // "Show Title (2020) S01E01" -> Title: "Show Title", Subtitle: "S01E01"
    
    const displayName = item.title;
    let title = '';
    let subtitle = '';
    
    if (item.type === 'movie' || item.type === 'show') {
      // For movies and shows: "Title (Year)"
      const match = displayName.match(/^(.+?)\s+\((\d{4})\)$/);
      if (match) {
        title = match[1].trim();
      } else {
        title = displayName;
      }
    } else if (item.type === 'season') {
      // For seasons: "Show Title (Year) Season X"
      const match = displayName.match(/^(.+?)\s+\((\d{4})\)\s+(Season\s+\d+)$/);
      if (match) {
        title = match[1].trim();
        subtitle = match[3].trim();
      } else {
        title = displayName;
      }
    } else if (item.type === 'episode') {
      // For episodes: "Show Title (Year) SXXEXX"
      const match = displayName.match(/^(.+?)\s+\((\d{4})\)\s+(S\d{2}E\d{2})$/);
      if (match) {
        title = match[1].trim();
        subtitle = match[3].trim();
      } else {
        title = displayName;
      }
    } else {
      title = displayName;
    }
    
    return { title, subtitle: subtitle || undefined };
  };

  const handleImport = async () => {
    setError('');
    setSummary(null);
    const parsed = parseTraktUrl(traktUrl);
    if (!parsed) {
      setError('Invalid Trakt list URL');
      return;
    }
    setImporting(true);
    try {
      // Always use fetchTraktList for consistent mapping
      const items: TraktListItem[] = await fetchTraktList(parsed.username, parsed.list, oidcUser?.access_token);
      
      // If fetchOnly mode, just return the items for review
      if (fetchOnly) {
        setSummary(`Fetched ${items.length} items for review`);
        if (onImportComplete) onImportComplete(items);
        return;
      }
      
      let timeline = timelineName;
      if (!timeline && createTimelineIfMissing) {
        // Prompt for timeline name/desc if needed
        const displayName = prompt('Enter timeline title:') || 'Imported Timeline';
        const description = prompt('Enter timeline description (optional):') || '';
        timeline = await createTimelineIfMissing(displayName, description);
        if (onTimelineCreated) onTimelineCreated(timeline);
      }
      if (!timeline) throw new Error('Timeline not specified or created');
      // Fetch existing entries for deduplication
      let existingEntries: TimelineEntry[] = [];
      try {
        existingEntries = await TimelineEntryService.listTimelineEntries(0, `${timelinesPath}/${timeline}`);
      } catch {
        // Ignore errors, treat as no existing entries
      }
      let created = 0, reused = 0, skipped = 0;
      const errors: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let found: MediaItem | undefined = undefined;
        try {
          const allMedia = await MediaLibraryService.getMediaItems();
          // Use the properly formatted title from TraktService
          const displayName = item.title; // Already includes proper formatting for shows/seasons/episodes
          found = allMedia.find(m => m.DisplayName.toLowerCase() === displayName.toLowerCase());
        } catch (err) {
          console.error('Error searching media items:', err);
          // Ignore errors, treat as not found
        }
        let mediaItem: MediaItem;
        try {
          if (found) {
            mediaItem = found;
            reused++;
          } else {
            const displayName = item.title; // Already includes proper formatting for shows/seasons/episodes
            const { title, subtitle } = extractTitleAndSubtitle(item);
            const req = {
              DisplayName: displayName,
              Title: title,
              Subtitle: subtitle,
              Description: '',
              MediaType: item.type,
              ReleaseDate: item.year ? `${item.year}-01-01` : undefined,
              ExternalLinks: JSON.stringify(item.ids),
            };
            mediaItem = await MediaLibraryService.createMediaItem(req);
            created++;
          }
          // Check if entry already exists for this media item
          const alreadyExists = existingEntries.some(e => e.mediaItem && mediaItem && (
            (e.mediaItem.Id === mediaItem.Id) ||
            (e.mediaItem.DisplayName?.toLowerCase() === mediaItem.DisplayName.toLowerCase())
          ));
          if (alreadyExists) {
            skipped++;
            continue;
          }
          const entryData = {
            displayName: mediaItem.DisplayName,
            mediaItem: {
              Name: mediaItem.DisplayName,
              Id: mediaItem.Id,
              DisplayName: mediaItem.DisplayName,
              CoverImageUrl: mediaItem.CoverImageUrl,
            },
            timelineId: 0, // Not used by backend, but required by type
            position: i + 1,
          };
          const timelinePath = `${timelinesPath}/${timeline}`;
          await TimelineEntryService.createTimelineEntry(entryData, timelinePath);
        } catch (err) {
          console.error(`Error processing item ${item.title}:`, err);
          errors.push(`${item.title} (${item.year || ''}): ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }
      const sum = `Imported ${items.length} items: ${created} created, ${reused} reused, ${skipped} skipped.${errors.length ? ' Errors: ' + errors.join('; ') : ''}`;
      setSummary(sum);
      if (onImportComplete) onImportComplete(sum);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ display: 'inline-block' }}>
      <button 
        onClick={() => setShow(s => !s)} 
        disabled={disabled} 
        style={{ 
          background: '#6f42c1', 
          color: '#fff', 
          border: 'none', 
          borderRadius: 8, 
          padding: '12px', 
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          opacity: disabled ? 0.6 : 1
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
        }}
      >
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
        </svg>
      </button>
      {show && (
        <div style={{ 
          position: 'absolute', 
          zIndex: 1000, 
          marginTop: 8, 
          background: '#fff', 
          borderRadius: 8, 
          padding: 16, 
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
          border: '1px solid #ddd',
          minWidth: 320
        }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Trakt List URL:</label>
            <input
              type="text"
              placeholder="https://trakt.tv/users/username/lists/listname"
              value={traktUrl}
              onChange={e => setTraktUrl(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc', fontSize: 16 }}
              disabled={importing}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button 
              onClick={() => setShow(false)} 
              style={{ 
                background: '#6c757d', 
                color: '#fff', 
                border: 'none', 
                borderRadius: 6, 
                padding: '8px 16px', 
                fontWeight: 500, 
                fontSize: 14, 
                cursor: 'pointer' 
              }}
            >
              Cancel
            </button>
            <button 
              onClick={handleImport} 
              disabled={importing || !traktUrl.trim()} 
              style={{ 
                background: importing || !traktUrl.trim() ? '#ccc' : '#007bff', 
                color: '#fff', 
                border: 'none', 
                borderRadius: 6, 
                padding: '8px 16px', 
                fontWeight: 500, 
                fontSize: 14, 
                cursor: importing || !traktUrl.trim() ? 'not-allowed' : 'pointer' 
              }}
            >
              {importing ? (fetchOnly ? 'Fetching...' : 'Importing...') : (fetchOnly ? 'Fetch Items' : 'Import')}
            </button>
          </div>
          {error && <div style={{ color: '#dc3545', marginTop: 12, fontSize: 14 }}>{error}</div>}
          {summary && <div style={{ color: '#155724', marginTop: 12, fontSize: 14 }}>{summary}</div>}
        </div>
      )}
    </div>
  );
};
