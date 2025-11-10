import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MediaLibrarySelector } from '../components/MediaLibrarySelector';
import { MediaItemCreateForm } from '../components/MediaItemCreateForm';
import { TimelineEntryService } from '../services/timelineEntryService';
import type { MediaItem } from '../services/mediaLibraryService';
import { timelinesPath } from '../projectPaths';

type MediaSelectionMode = 'select' | 'create';

export default function TimelineEntryCreatePage() {
  const { timelineId: timelineName } = useParams<{ timelineId: string }>();
  const navigate = useNavigate();
  const [selectionMode, setSelectionMode] = useState<MediaSelectionMode>('select');
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [position, setPosition] = useState<number>(1);
  const [chronologicalDate, setChronologicalDate] = useState('');
  const [chronologicalDescription, setChronologicalDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [entryLabel, setEntryLabel] = useState('mainstory');
  const [importance, setImportance] = useState('essential');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSelect = (media: MediaItem) => setSelectedMedia(media);

  const handleMediaCreated = (media: MediaItem) => {
    setSelectedMedia(media);
    setSelectionMode('select'); // Switch back to the timeline entry form after creating media
  };

  const handleSave = async () => {
    if (!timelineName || !selectedMedia) return;
    setSaving(true);
    setError('');
    try {
      // TimelineEntry should be created under the selected timeline's path
      const parentPath = `${timelinesPath}/${timelineName}`;
      await TimelineEntryService.createTimelineEntry({
        displayName: selectedMedia.DisplayName,
        mediaItem: {
          Id: selectedMedia.Id,
          Name: selectedMedia.DisplayName.replace(/\s+/g, '-').toLowerCase(),
          DisplayName: selectedMedia.DisplayName,
          CoverImageUrl: selectedMedia.CoverImageUrl,
        },
        timelineId: 0, // Not used in backend, but required by type
        position,
        chronologicalDate: chronologicalDate || undefined,
        chronologicalDescription: chronologicalDescription || undefined,
        notes,
        entryLabel,
        importance,
      }, parentPath);
      navigate(`/timelines/${timelineName}`);
    } catch {
      setError('Failed to create timeline entry.');
    } finally {
      setSaving(false);
    }
  };

  const renderMediaSelection = () => {
    if (selectionMode === 'create') {
      return (
        <div>
          <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#495057' }}>Create New Media Item</h3>
            <button 
              onClick={() => setSelectionMode('select')} 
              style={{ 
                background: '#6c757d', 
                color: '#fff', 
                border: 'none', 
                borderRadius: 6, 
                padding: '8px 16px', 
                cursor: 'pointer',
                fontSize: 14
              }}
            >
              ← Back to Selection
            </button>
          </div>
          <MediaItemCreateForm 
            onSuccess={handleMediaCreated}
            onCancel={() => setSelectionMode('select')}
          />
        </div>
      );
    }

    return (
      <div>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          marginBottom: 24,
          padding: 16,
          background: '#f8f9fa',
          borderRadius: 8,
          border: '1px solid #e9ecef'
        }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#495057' }}>
            Choose Media Item
          </h3>
          <button 
            onClick={() => setSelectionMode('create')} 
            style={{ 
              background: '#28a745', 
              color: '#fff', 
              border: 'none', 
              borderRadius: 6, 
              padding: '10px 16px', 
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Create New Media
          </button>
        </div>
        <MediaLibrarySelector onSelect={handleSelect} />
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: '#495057', marginBottom: 8 }}>
          Add Media to Timeline
        </h2>
        <p style={{ color: '#6c757d', margin: 0 }}>
          Select an existing media item from your library or create a new one
        </p>
      </div>

      {!selectedMedia ? (
        renderMediaSelection()
      ) : (
        <div style={{
          background: '#fff',
          border: '1px solid #e9ecef',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}>
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 18, fontWeight: 600, color: '#495057', marginBottom: 16 }}>
              Configure Timeline Entry
            </h3>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 16,
              padding: 16,
              background: '#f8f9fa',
              borderRadius: 8,
              border: '1px solid #e9ecef'
            }}>
              {selectedMedia.CoverImageUrl && (
                <img 
                  src={selectedMedia.CoverImageUrl} 
                  alt={selectedMedia.DisplayName}
                  style={{ width: 60, height: 90, objectFit: 'cover', borderRadius: 4 }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: '#495057', marginBottom: 4 }}>
                  {selectedMedia.DisplayName}
                </div>
                <div style={{ fontSize: 14, color: '#6c757d' }}>
                  {selectedMedia.MediaType} • {selectedMedia.ReleaseDate}
                </div>
              </div>
              <button 
                onClick={() => setSelectedMedia(null)} 
                style={{ 
                  background: '#6c757d', 
                  color: '#fff', 
                  border: 'none', 
                  borderRadius: 6, 
                  padding: '8px 16px', 
                  cursor: 'pointer',
                  fontSize: 14
                }}
              >
                Change
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>
                  Position
                </label>
                <input 
                  type="number" 
                  value={position} 
                  min={1} 
                  onChange={e => setPosition(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #ced4da',
                    borderRadius: 6,
                    fontSize: 14
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>
                  Entry Label
                </label>
                <select 
                  value={entryLabel} 
                  onChange={e => setEntryLabel(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #ced4da',
                    borderRadius: 6,
                    fontSize: 14
                  }}
                >
                  <option value="mainstory">Main story</option>
                  <option value="firstappearance">First appearance</option>
                  <option value="flashback">Flashback</option>
                  <option value="cameo">Cameo</option>
                  <option value="reference">Reference</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>
                Importance
              </label>
              <select 
                value={importance} 
                onChange={e => setImportance(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ced4da',
                  borderRadius: 6,
                  fontSize: 14
                }}
              >
                <option value="essential">Essential</option>
                <option value="important">Important</option>
                <option value="optional">Optional</option>
                <option value="skipok">SkipOk</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>
                Notes
              </label>
              <textarea 
                value={notes} 
                onChange={e => setNotes(e.target.value)} 
                rows={3} 
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ced4da',
                  borderRadius: 6,
                  fontSize: 14,
                  resize: 'vertical'
                }}
                placeholder="Optional notes about this entry..."
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>
                Chronological Date (Optional)
              </label>
              <input 
                type="datetime-local" 
                value={chronologicalDate} 
                onChange={e => setChronologicalDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ced4da',
                  borderRadius: 6,
                  fontSize: 14
                }}
                placeholder="In-universe date for chronological sorting"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>
                Chronological Description (Optional)
              </label>
              <input 
                type="text" 
                value={chronologicalDescription} 
                onChange={e => setChronologicalDescription(e.target.value)}
                maxLength={200}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #ced4da',
                  borderRadius: 6,
                  fontSize: 14
                }}
                placeholder="e.g., 'During the Clone Wars', 'Before Episode IV'"
              />
            </div>

            {error && (
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 6,
                padding: 16,
                color: '#dc2626'
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button 
                onClick={() => setSelectedMedia(null)}
                style={{ 
                  background: '#f8f9fa', 
                  color: '#495057', 
                  border: '1px solid #e9ecef', 
                  borderRadius: 6, 
                  padding: '10px 20px', 
                  cursor: 'pointer',
                  fontSize: 14
                }}
              >
                Back
              </button>
              <button 
                onClick={handleSave} 
                disabled={saving}
                style={{ 
                  background: saving ? '#94a3b8' : '#2a4d8f', 
                  color: '#fff', 
                  border: 'none', 
                  borderRadius: 6, 
                  padding: '10px 20px', 
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 500
                }}
              >
                {saving ? 'Adding to Timeline...' : 'Add to Timeline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
