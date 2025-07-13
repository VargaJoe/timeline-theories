import React, { useState } from 'react';
import type { TraktListItem } from '../services/traktService';
import { fetchTraktList } from '../services/traktService';
import MediaLibraryService from '../services/mediaLibraryService';
import type { MediaItem } from '../services/mediaLibraryService';
import type { TimelineEntry } from '../services/timelineEntryService';
import { timelinesPath } from '../projectPaths';
import { TimelineEntryService } from '../services/timelineEntryService';

interface TraktImportDialogProps {
  timelineName?: string;
  onTimelineCreated?: (timelineName: string) => void;
  onImportComplete?: (summary: string) => void;
  createTimelineIfMissing?: (displayName: string, description: string) => Promise<string>;
  disabled?: boolean;
}

export const TraktImportDialog: React.FC<TraktImportDialogProps> = ({
  timelineName,
  onTimelineCreated,
  onImportComplete,
  createTimelineIfMissing,
  disabled
}) => {
  const [show, setShow] = useState(false);
  const [traktUrl, setTraktUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<string|null>(null);

  const parseTraktUrl = (url: string) => {
    try {
      const m = url.match(/trakt.tv\/users\/([^/]+)\/lists\/([^/?#]+)/i);
      if (!m) return null;
      return { username: m[1], list: m[2] };
    } catch { return null; }
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
      const items: TraktListItem[] = await fetchTraktList(parsed.username, parsed.list);
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
          // Use 'title (year)' format for matching if year is present
          const displayName = item.year ? `${item.title} (${item.year})` : item.title;
          found = allMedia.find(m => m.DisplayName.toLowerCase() === displayName.toLowerCase());
        } catch {
          // Ignore errors, treat as not found
        }
        let mediaItem: MediaItem;
        try {
          if (found) {
            mediaItem = found;
            reused++;
          } else {
            const displayName = item.year ? `${item.title} (${item.year})` : item.title;
            const req = {
              DisplayName: displayName,
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
          await TimelineEntryService.createTimelineEntry({
            displayName: mediaItem.DisplayName,
            mediaItem: {
              Name: mediaItem.DisplayName,
              Id: mediaItem.Id,
              DisplayName: mediaItem.DisplayName,
              CoverImageUrl: mediaItem.CoverImageUrl,
            },
            timelineId: 0, // Not used by backend, but required by type
            position: i + 1,
          }, `${timelinesPath}/${timeline}`);
        } catch (err) {
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
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setShow(s => !s)} disabled={disabled} style={{ background: '#2a4d8f', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 500, fontSize: 16, cursor: 'pointer' }}>
        {show ? 'Cancel Trakt Import' : 'Import from Trakt'}
      </button>
      {show && (
        <div style={{ marginTop: 16, background: '#f8f9fa', borderRadius: 8, padding: 16, boxShadow: '0 1px 4px #0001' }}>
          <div style={{ marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Paste Trakt list URL"
              value={traktUrl}
              onChange={e => setTraktUrl(e.target.value)}
              style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #ccc', fontSize: 16 }}
              disabled={importing}
            />
          </div>
          <button onClick={handleImport} disabled={importing || !traktUrl.trim()} style={{ background: '#007bff', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 500, fontSize: 16, cursor: importing ? 'not-allowed' : 'pointer' }}>
            {importing ? 'Importing...' : 'Import'}
          </button>
          {error && <div style={{ color: '#dc3545', marginTop: 8 }}>{error}</div>}
          {summary && <div style={{ color: '#155724', marginTop: 8 }}>{summary}</div>}
        </div>
      )}
    </div>
  );
};
