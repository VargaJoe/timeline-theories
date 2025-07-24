import React, { useState } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { TraktImportDialog } from './TraktImportDialog';
// import { fetchTraktList } from '../services/traktService';
import type { TraktListItem } from '../services/traktService';
import MediaLibraryService from '../services/mediaLibraryService';
import type { MediaItem } from '../services/mediaLibraryService';
import { TimelineEntryService } from '../services/timelineEntryService';
import { useNavigate } from 'react-router-dom';
import { createTimeline } from '../services/timelineService';
import { timelinesPath } from '../projectPaths';

export const TimelineCreateForm: React.FC = () => {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');  
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState<'chronological' | 'release'>('chronological');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [importSummary, setImportSummary] = useState<string|null>(null);
  const navigate = useNavigate();

  // Only keep the review items state - TraktImportDialog handles the import process
  const [traktReviewItems, setTraktReviewItems] = useState<TraktListItem[]|null>(null);
  const [traktProcessing, setTraktProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setImportSummary(null);
    if (!name.trim()) {
      setError('Title is required');
      return;
    }
    if (name.trim().length < 3) {
      setError('Title must be at least 3 characters long');
      return;
    }
    setLoading(true);
    try {
      const timeline = await createTimeline({ 
        name: name.trim(), 
        displayName: displayName.trim(),
        description: description.trim() || undefined, 
        sortOrder 
      });
      let created = 0, reused = 0;
      const errors: string[] = [];
      if (traktReviewItems && traktReviewItems.length > 0) {
        setTraktProcessing(true);
        for (let i = 0; i < traktReviewItems.length; i++) {
          const item = traktReviewItems[i];
          let found: MediaItem | undefined = undefined;
          try {
            const allMedia = await MediaLibraryService.getMediaItems();
            // Consistent 'title (year)' format from title for matching if year is present, like TraktImportDialog
            const displayName = item.title;
            found = allMedia.find(m => m.DisplayName.toLowerCase() === displayName.toLowerCase());
          } catch {
            // Ignore errors in searching media items
          }
          let mediaItem: MediaItem;
          try {
            if (found) {
              mediaItem = found;
              reused++;
            } else {
              // Consistent 'title (year)' format is already set in title
              const displayName = item.title;
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
            await TimelineEntryService.createTimelineEntry({
              displayName: mediaItem.DisplayName,
              mediaItem: {
                Name: mediaItem.DisplayName,
                Id: mediaItem.Id,
                DisplayName: mediaItem.DisplayName,
                CoverImageUrl: mediaItem.CoverImageUrl,
              },
              timelineId: Number(timeline.id),
              position: i + 1,
            }, `${timelinesPath}/${timeline.name}`);
          } catch (err) {
            errors.push(`${item.title} (${item.year || ''}): ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
        setTraktProcessing(false);
        setImportSummary(`Imported ${traktReviewItems.length} items: ${created} created, ${reused} reused.${errors.length ? ' Errors: ' + errors.join('; ') : ''}`);
      }
      setSuccess(true);
      setLoading(false);
      setTimeout(() => {
        navigate(`/timelines/${timeline.name}`);
      }, 1500);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to create timeline');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '0 auto' }}>
      {/* Trakt Import Button - just for fetching items to review */}
      <TraktImportDialog
        disabled={loading || traktProcessing}
        fetchOnly={true}
        onImportComplete={(items) => {
          // Don't create timeline here, just set items for review
          if (Array.isArray(items)) {
            setTraktReviewItems(items);
          }
        }}
      />
      {success ? (
        <div style={{
          background: '#d4edda',
          borderRadius: 12,
          border: '1px solid #c3e6cb',
          padding: 32,
          textAlign: 'center'
        }}>
          <h2 style={{ color: '#155724', marginBottom: 16 }}>Timeline Created!</h2>
          <p style={{ color: '#155724', margin: 0 }}>
            Redirecting you to your new timeline...
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
          padding: 32,
          display: 'flex',
          flexDirection: 'column',
          gap: 16
        }}>
          <h2 style={{ textAlign: 'center', marginBottom: 24, color: '#2a4d8f' }}>Create New Timeline</h2>

          {/* Review/edit imported Trakt items before timeline creation */}
          {traktReviewItems && (
            <div style={{ background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <strong>Review Imported Items ({traktReviewItems.length})</strong>
              <ul style={{ maxHeight: 200, overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' }}>
                {traktReviewItems.map((item, idx) => (
                  <li key={idx} style={{ padding: 4, borderBottom: '1px solid #eee', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {item.type.toUpperCase()}: {item.title}
                    <button type="button" style={{ marginLeft: 'auto', background: '#b71c1c', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', fontSize: 13, cursor: 'pointer' }} onClick={() => {
                      setTraktReviewItems(traktReviewItems.filter((_, i) => i !== idx));
                    }}>Remove</button>
                  </li>
                ))}
              </ul>
              <button type="button" style={{ marginTop: 10, background: '#aaa', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setTraktReviewItems(null)}>Clear Imported Items</button>
            </div>
          )}

          {traktProcessing && (
            <div style={{ color: '#2a4d8f', background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 4, padding: '12px', textAlign: 'center', fontSize: 14, marginBottom: 8 }}>
              Importing items into timeline...
            </div>
          )}

          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Title *</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Enter timeline title..."
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 6,
                border: '1px solid #ccc',
                fontSize: 16,
                boxSizing: 'border-box'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Url *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter timeline url slug..."
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 6,
                border: '1px solid #ccc',
                fontSize: 16,
                boxSizing: 'border-box'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Description (HTML supported)</label>
            <ReactQuill
              value={description}
              onChange={setDescription}
              theme="snow"
              style={{
                width: '100%',
                minHeight: 80,
                marginBottom: 8,
                background: '#fff',
                borderRadius: 6,
                border: '1px solid #ccc',
                fontSize: 16,
                boxSizing: 'border-box',
                color: '#222',
              }}
              className="quill-editor-dark"
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Sort Order</label>
            <select
              value={sortOrder}
              onChange={e => setSortOrder(e.target.value as 'chronological' | 'release')}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 6,
                border: '1px solid #ccc',
                fontSize: 16,
                boxSizing: 'border-box'
              }}
            >
              <option value="chronological">Chronological Order</option>
              <option value="release">Release Order</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={loading || traktProcessing}
            style={{
              background: loading || traktProcessing ? '#6c757d' : '#2a4d8f',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '14px 0',
              fontSize: 16,
              fontWeight: 600,
              cursor: loading || traktProcessing ? 'not-allowed' : 'pointer',
              marginTop: 8,
              transition: 'background-color 0.2s'
            }}
          >
            {loading || traktProcessing ? 'Creating Timeline...' : 'Create Timeline'}
          </button>
          {importSummary && (
            <div style={{ color: '#155724', background: '#e3fcec', border: '1px solid #c3e6cb', borderRadius: 4, padding: '12px', textAlign: 'center', fontSize: 14, marginTop: 8 }}>
              {importSummary}
            </div>
          )}
          {error && (
            <div style={{ 
              color: '#721c24', 
              backgroundColor: '#f8d7da',
              border: '1px solid #f5c6cb',
              borderRadius: 4,
              padding: '12px',
              textAlign: 'center',
              fontSize: 14
            }}>
              {error}
            </div>
          )}
        </form>
      )}
    </div>
  );
};
