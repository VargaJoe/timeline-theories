import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { Timeline } from '../services/timelineService';
import { repository } from '../services/sensenet';
import { TimelineEntryService } from '../services/timelineEntryService';
import type { TimelineEntry } from '../services/timelineEntryService';
// import { MediaLibraryService } from '../services/mediaLibraryService';
// import type { MediaItem } from '../services/mediaLibraryService';

export const TimelineViewPage: React.FC = () => {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  // const [mediaMap, setMediaMap] = useState<Record<number, MediaItem>>({});
  const [entriesLoading, setEntriesLoading] = useState(true);
  const { id } = useParams();
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    
    const loadTimeline = async () => {
      try {
        setLoading(true);
        // Load the specific timeline by ID
        const result = await repository.load({
          idOrPath: Number(id),
          oDataOptions: {
            select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate'],
          },
        });
        
        setTimeline({
          id: String(result.d.Id),
          name: result.d.DisplayName,
          description: result.d.Description || '',
          sort_order: result.d.SortOrder || 'chronological',
          created_at: result.d.CreationDate,
        });
        // Load timeline entries and media items
        setEntriesLoading(true);
        const timelineId = result.d.Id;
        const parentPath = result.d.Path;
        const entries = await TimelineEntryService.listTimelineEntries(Number(timelineId), parentPath);
        setEntries(entries);
        // No need to load media items separately; entries have expanded mediaItem
        setEntriesLoading(false);
      } catch (err) {
        console.error('Failed to load timeline:', err);
        setError('Failed to load timeline');
        setEntriesLoading(false);
      } finally {
        setLoading(false);
      }
    };

    loadTimeline();
  }, [id]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}>Loading timeline...</div>;
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ color: 'red', marginBottom: 16 }}>{error}</div>
        <Link to="/timelines" style={{ color: '#2a4d8f', textDecoration: 'none' }}>← Back to timelines</Link>
      </div>
    );
  }

  if (!timeline) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ marginBottom: 16 }}>Timeline not found</div>
        <Link to="/timelines" style={{ color: '#2a4d8f', textDecoration: 'none' }}>← Back to timelines</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <div style={{ marginBottom: 24 }}>
        <Link to="/timelines" style={{ color: '#2a4d8f', textDecoration: 'none', fontSize: 14 }}>
          ← Back to timelines
        </Link>
      </div>
      <div style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 2px 12px #0001',
        padding: 32
      }}>
        <h1 style={{ marginBottom: 16, color: '#2a4d8f' }}>{timeline.name}</h1>
        {timeline.description && (
          <p style={{ color: '#666', marginBottom: 24, lineHeight: 1.6, fontSize: 16 }}>{timeline.description}</p>
        )}
        <div style={{ display: 'flex', gap: 24, marginBottom: 32, fontSize: 14, color: '#888' }}>
          <div>
            <strong>Sort Order:</strong> {timeline.sort_order === 'chronological' ? 'Chronological' : 'Release Order'}
          </div>
          {timeline.created_at && (
            <div>
              <strong>Created:</strong> {new Date(timeline.created_at).toLocaleDateString()}
            </div>
          )}
        </div>
        <div style={{ marginBottom: 24, textAlign: 'right' }}>
          <Link to={`/timelines/${timeline.id}/add-entry`} style={{ background: '#2a4d8f', color: '#fff', padding: '8px 16px', borderRadius: 6, textDecoration: 'none', fontWeight: 500 }}>
            + Add Media Entry
          </Link>
        </div>
        <h3 style={{ marginBottom: 16 }}>Timeline Entries</h3>
        {entriesLoading ? (
          <div>Loading entries...</div>
        ) : entries.length === 0 ? (
          <div style={{ color: '#888', fontStyle: 'italic' }}>No entries yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#f8f9fa', borderRadius: 8 }}>
            <thead>
              <tr style={{ background: '#e9ecef' }}>
                <th style={{ padding: 8, textAlign: 'left' }}>#</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Media</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Title</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const media = entry.mediaItem;
                const isBroken = !media || !media.Id;
                // const displayName = isBroken ? 'Missing Media' : (entry?.displayName || 'Unknown');
                const displayName = entry?.displayName || 'Unknown';
                const coverUrl = !isBroken ? (media?.CoverImageUrl || '') : '';
                return (
                  <tr
                    key={entry.id}
                    style={{ borderBottom: '1px solid #e9ecef', background: isBroken ? '#fff3cd' : undefined }}
                  >
                    <td style={{ padding: 8 }}>{entry.position}</td>
                    <td style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                      {isBroken ? (
                        <div style={{ width: 48, height: 72, background: '#f8d7da', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#721c24', fontWeight: 600, fontSize: 12, border: '1px solid #f5c6cb' }}>
                          !
                        </div>
                      ) : coverUrl ? (
                        <img
                          src={coverUrl}
                          alt={displayName}
                          style={{ width: 48, height: 72, objectFit: 'cover', borderRadius: 4, boxShadow: '0 1px 4px #0002' }}
                        />
                      ) : (
                        <div style={{ width: 48, height: 72, background: '#ddd', borderRadius: 4 }} />
                      )}
                    </td>
                    <td style={{ padding: 8 }}>
                      <span style={{ fontWeight: 500, color: isBroken ? '#b94a48' : undefined }}>
                        {displayName}
                      </span>
                    </td>
                    <td style={{ padding: 8 }}>{entry.notes || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
