import React, { useState, useRef } from 'react';
import { NativeCreationIntent } from '../services/nativeApi';
import type { TraktListItem } from '../services/traktService';
import { fetchTraktList } from '../services/traktService';
import MediaLibraryService from '../services/mediaLibraryService';
import type { MediaItem } from '../services/mediaLibraryService';
import { timelinesPath, mediaLibraryPath } from '../projectPaths';
import { TimelineEntryService } from '../services/timelineEntryService';

import { assertOperations, captureOperationContext, type Operation } from '../services/sensenet';
import { TIMELINE_ENTRY_CONTENT_TYPE, MEDIA_ITEM_CONTENT_TYPE } from '../contentTypes';
import { usePermissions } from '../hooks/usePermissions';

interface TraktImportDialogProps {
  timelineName?: string;
  onImportComplete?: (summary: string | TraktListItem[]) => void;
  disabled?: boolean;
  fetchOnly?: boolean; // New prop: if true, only fetch items and return them without importing
}

export const TraktImportDialog: React.FC<TraktImportDialogProps> = ({
  timelineName,
  onImportComplete,
  disabled,
  fetchOnly = false
}) => {
  const [show, setShow] = useState(false);
  const [traktUrl, setTraktUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<string|null>(null);
  const batch = useRef<{ key: string; rows: { item: TraktListItem; media: NativeCreationIntent; entry: NativeCreationIntent }[] } | null>(null);

  const timelinePath = timelineName ? `${timelinesPath}/${timelineName}` : '';
  const importOperations: Operation[] = timelinePath ? [{ target: timelinePath, action: 'create', contentType: TIMELINE_ENTRY_CONTENT_TYPE }, { target: mediaLibraryPath, action: 'create', contentType: MEDIA_ITEM_CONTENT_TYPE }] : [];
  const canImport = usePermissions(importOperations);

  const parseTraktUrl = (url: string) => {
    try {
      const m = url.match(/trakt.tv\/users\/([^/]+)\/lists\/([^/?#]+)/i);
      if (!m) return null;
      return { username: m[1], list: m[2] };
    } catch { return null; }
  };

  const extractTitleAndSubtitle = (item: TraktListItem) => {
    // No more parsing! Use the clean data directly from TraktService
    const cleanTitle = item.title; // Clean show/movie title 
    const displayName = item.formattedTitle;   // Formatted title for display
    
    let subtitle = '';
    
    if (item.type === 'season') {
      subtitle = `Season ${item.season}`;
    } else if (item.type === 'episode') {
      // Prioritize episode title over episode number for better UX
      if (item.episodeTitle) {
        subtitle = item.episodeTitle; // Use meaningful episode title like "Pilot" or "The One Where..."
      } else {
        // Fallback to episode number if no title available
        const seasonNum = item.season!.toString().padStart(2, '0');
        const episodeNum = item.episode!.toString().padStart(2, '0');
        subtitle = `S${seasonNum}E${episodeNum}`;
      }
    }
    
    return { 
      title: cleanTitle,
      subtitle: subtitle || undefined,
      displayName 
    };
  };

  const handleImport = async () => {
    const checkContext = captureOperationContext();
    setError('');
    setSummary(null);
    const parsed = parseTraktUrl(traktUrl);
    if (!parsed) {
      setError('Invalid Trakt list URL');
      return;
    }
    setImporting(true);
    try {
      const key = JSON.stringify({ timelinePath, ...parsed });
      if (batch.current && batch.current.key !== key) throw new Error('Retry the original list and timeline, or start a new import after checking its outcome.');
      // Always use fetchTraktList for consistent mapping
      const items: TraktListItem[] = batch.current ? batch.current.rows.map(row => row.item) : await fetchTraktList(parsed.username, parsed.list);
      
      // If fetchOnly mode, just return the items for review
      if (fetchOnly) {
        setSummary(`Fetched ${items.length} items for review`);
        if (onImportComplete) onImportComplete(items);
        return;
      }
      
      if (!timelineName) throw new Error('Create the timeline first, then import from its page.');
      batch.current ??= { key, rows: items.map(item => ({ item, media: new NativeCreationIntent(), entry: new NativeCreationIntent('entry-') })) };
      const attempt = batch.current;
      // Each provider occurrence remains a separate timeline occurrence.
      await assertOperations(importOperations);
      let created = 0;
      for (const [index, row] of attempt.rows.entries()) {
        checkContext();
        if (batch.current !== attempt) throw new Error('The import dialog changed before the next item.');
        const { item } = row;
        const { title, subtitle, displayName } = extractTitleAndSubtitle(item);
        const mediaItem: MediaItem = await MediaLibraryService.createMediaItem({
          DisplayName: displayName,
          Title: title,
          Subtitle: subtitle,
          Description: '',
          MediaType: item.type,
          ReleaseDate: item.year ? `${item.year}-01-01` : undefined,
          Year: item.year,
          ExternalLinks: JSON.stringify(Object.fromEntries(Object.entries(item.ids).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))),
        }, row.media);
        created++;
        checkContext();
        await TimelineEntryService.createTimelineEntry({
          displayName: mediaItem.DisplayName,
          mediaItem: { Name: mediaItem.Name, Id: mediaItem.Id, DisplayName: mediaItem.DisplayName, CoverImageUrl: mediaItem.CoverImageUrl },
          timelineId: 0,
          position: index + 1,
        }, timelinePath, row.entry);
      }
      const sum = `Imported ${items.length} items: ${created} created.`;
      setSummary(sum);
      if (onImportComplete) onImportComplete(sum);
      batch.current = null;
    } catch (err) {
      if (batch.current?.rows.every(row => !row.media.hasStartedApply && !row.entry.hasStartedApply)) batch.current = null;
      setError(err instanceof Error ? err.message : 'Failed to import');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ display: 'inline-block' }}>
      <button 
        onClick={() => { batch.current = null; setShow(s => !s); }}
        disabled={importing || disabled || (!fetchOnly && !canImport)}
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
              onClick={() => { batch.current = null; setShow(false); }}
              disabled={importing}
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
              disabled={importing || !traktUrl.trim() || (!fetchOnly && !canImport)}
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
