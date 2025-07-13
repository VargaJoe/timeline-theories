import React, { useState } from 'react';
// import { fetchTraktList } from '../services/traktService';
import type { TraktListItem } from '../services/traktService';
import MediaLibraryService from '../services/mediaLibraryService';
import type { MediaItem } from '../services/mediaLibraryService';
import { TimelineEntryService } from '../services/timelineEntryService';
import { useNavigate } from 'react-router-dom';
import { createTimeline } from '../services/timelineService';

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

  // Trakt import modal state
  const [showTraktImport, setShowTraktImport] = useState(false);
  const [traktUrl, setTraktUrl] = useState('');
  const [traktImportError, setTraktImportError] = useState('');
  const [traktImportLoading, setTraktImportLoading] = useState(false);
  const [traktItems, setTraktItems] = useState<TraktListItem[]|null>(null);
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
      let created = 0, reused = 0, errors: string[] = [];
      if (traktReviewItems && traktReviewItems.length > 0) {
        setTraktProcessing(true);
        for (let i = 0; i < traktReviewItems.length; i++) {
          const item = traktReviewItems[i];
          let found: MediaItem | undefined = undefined;
          try {
            const allMedia = await MediaLibraryService.getMediaItems();
            found = allMedia.find(m => m.DisplayName.toLowerCase() === item.title.toLowerCase() && (!item.year || m.ReleaseDate?.startsWith(String(item.year))));
          } catch (e) {}
          let mediaItem: MediaItem;
          try {
            if (found) {
              mediaItem = found;
              reused++;
            } else {
              const req = {
                DisplayName: item.title,
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
            }, `/Root/Content/Timelines/${timeline.name}`);
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

          <button
            type="button"
            style={{
              background: '#ed1c24', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 0', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 8
            }}
            onClick={() => setShowTraktImport(true)}
          >
            Import from Trakt List
          </button>

          {showTraktImport && (
            <div style={{ background: '#f7f7f7', border: '1px solid #ccc', borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <label style={{ fontWeight: 500 }}>Trakt List URL</label>
              <div style={{ color: '#b71c1c', fontSize: 13, marginBottom: 6 }}>
                Note: The Trakt API does not support CORS. For development, use a CORS proxy or server-side function.
              </div>
              <input
                value={traktUrl}
                onChange={e => setTraktUrl(e.target.value)}
                placeholder="https://trakt.tv/users/USERNAME/lists/LISTNAME"
                style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid #ccc', marginTop: 6, marginBottom: 8 }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={{ background: '#2a4d8f', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}
                  onClick={async () => {
                    setTraktImportError('');
                    setTraktImportLoading(true);
                    setTraktItems(null);
                    // Parse username and list slug from URL, strip query params from slug
                    const match = traktUrl.match(/trakt.tv\/users\/(.+?)\/lists\/(.+?)(\/|\?|$)/);
                    if (!match) {
                      setTraktImportError('Invalid Trakt list URL');
                      setTraktImportLoading(false);
                      return;
                    }
                    const username = match[1];
                    let listSlug = match[2];
                    // Remove query parameters from listSlug if present
                    listSlug = listSlug.split('?')[0];
                    try {
                      // Call Netlify Function proxy
                      const resp = await fetch(`/.netlify/functions/trakt-proxy?username=${encodeURIComponent(username)}&list=${encodeURIComponent(listSlug)}`);
                      if (!resp.ok) throw new Error('Failed to fetch Trakt list from proxy');
                      const data = await resp.json();
                      // Map to TraktListItem[]
                      const items = data.map((item: any) => ({
                        type: item.type,
                        ids: item[item.type]?.ids,
                        title: item[item.type]?.title,
                        year: item[item.type]?.year
                      }));
                      setTraktItems(items);
                    } catch (err) {
                      setTraktImportError(err instanceof Error ? err.message : 'Failed to fetch Trakt list.\n\nCheck your Netlify Function and environment variable.');
                    }
                    setTraktImportLoading(false);
                  }}
                  disabled={traktImportLoading}
                >
                  {traktImportLoading ? 'Importing...' : 'Import'}
                </button>
                <button type="button" style={{ background: '#aaa', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }} onClick={() => setShowTraktImport(false)}>
                  Cancel
                </button>
              </div>
              {traktImportError && <div style={{ color: '#b71c1c', marginTop: 8 }}>{traktImportError}</div>}
              {traktItems && (
                <div style={{ marginTop: 12 }}>
                  <strong>Items found: {traktItems.length}</strong>
                  <ul style={{ maxHeight: 200, overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' }}>
                    {traktItems.map((item, idx) => (
                      <li key={idx} style={{ padding: 4, borderBottom: '1px solid #eee', fontSize: 15 }}>
                        {item.type.toUpperCase()}: {item.title} {item.year ? `(${item.year})` : ''}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    style={{ marginTop: 10, background: '#2a4d8f', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => {
                      setTraktReviewItems(traktItems);
                      setShowTraktImport(false);
                    }}
                  >
                    Use These Items
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Review/edit imported Trakt items before timeline creation */}
          {traktReviewItems && (
            <div style={{ background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <strong>Review Imported Items ({traktReviewItems.length})</strong>
              <ul style={{ maxHeight: 200, overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' }}>
                {traktReviewItems.map((item, idx) => (
                  <li key={idx} style={{ padding: 4, borderBottom: '1px solid #eee', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {item.type.toUpperCase()}: {item.title} {item.year ? `(${item.year})` : ''}
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
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 500 }}>Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe your timeline..."
              rows={3}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 6,
                border: '1px solid #ccc',
                fontSize: 16,
                resize: 'vertical',
                boxSizing: 'border-box'
              }}
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
