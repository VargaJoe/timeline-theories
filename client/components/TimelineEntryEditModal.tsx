import { useState, useEffect } from 'react';
import { TimelineEntryService } from '../services/timelineEntryService';
import type { TimelineEntry } from '../services/timelineEntryService';
import { MediaLibraryService } from '../services/mediaLibraryService';

interface TimelineEntryEditModalProps {
  entry: TimelineEntry | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

type EditMode = 'entry' | 'media';

export function TimelineEntryEditModal({ entry, isOpen, onClose, onSave }: TimelineEntryEditModalProps) {
  const [editMode, setEditMode] = useState<EditMode>('entry');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Entry form state
  const [position, setPosition] = useState(1);
  const [chronologicalDate, setChronologicalDate] = useState('');
  const [chronologicalDescription, setChronologicalDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [entryLabel, setEntryLabel] = useState('mainstory');
  const [importance, setImportance] = useState('essential');

  // Media form state
  const [mediaDisplayName, setMediaDisplayName] = useState('');
  const [mediaType, setMediaType] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [description, setDescription] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');

  useEffect(() => {
    if (entry && isOpen) {
      // Initialize entry form
      setPosition(entry.position);
      setChronologicalDate(entry.chronologicalDate || '');
      setChronologicalDescription(entry.chronologicalDescription || '');
      setNotes(entry.notes || '');
      setEntryLabel(entry.entryLabel || 'mainstory');
      setImportance(entry.importance || 'essential');

      // Initialize media form
      if (entry.mediaItem) {
        setMediaDisplayName(entry.mediaItem.DisplayName || '');
        setMediaType(entry.mediaItem.MediaType || '');
        setReleaseDate(entry.mediaItem.ReleaseDate || '');
        setDescription(entry.mediaItem.Description || '');
        setCoverImageUrl(entry.mediaItem.CoverImageUrl || '');
      }

      setEditMode('entry');
      setError('');
    }
  }, [entry, isOpen]);

  const handleSaveEntry = async () => {
    if (!entry) return;

    setLoading(true);
    setError('');

    try {
      await TimelineEntryService.updateTimelineEntry(entry.id, {
        position,
        chronologicalDate: chronologicalDate || undefined,
        chronologicalDescription: chronologicalDescription || undefined,
        notes: notes || undefined,
        entryLabel,
        importance,
      });

      onSave();
      onClose();
    } catch {
      setError('Failed to update timeline entry');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMedia = async () => {
    if (!entry?.mediaItem) return;

    setLoading(true);
    setError('');

    try {
      await MediaLibraryService.updateMediaItem(entry.mediaItem.Id, {
        DisplayName: mediaDisplayName,
        MediaType: mediaType,
        ReleaseDate: releaseDate,
        Description: description,
        CoverImageUrl: coverImageUrl,
      });

      onSave();
      onClose();
    } catch {
      setError('Failed to update media item');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !entry) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 20
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 12,
        padding: 24,
        maxWidth: 600,
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#1f2937' }}>
            Edit Timeline Entry
          </h3>
          <p style={{ margin: '8px 0 0 0', color: '#6b7280', fontSize: 14 }}>
            {entry.mediaItem?.DisplayName}
          </p>
        </div>

        {/* Mode Toggle */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', gap: 4, background: '#f3f4f6', borderRadius: 8, padding: 4 }}>
            <button
              onClick={() => setEditMode('entry')}
              style={{
                flex: 1,
                padding: '8px 16px',
                border: 'none',
                borderRadius: 6,
                background: editMode === 'entry' ? '#fff' : 'transparent',
                color: editMode === 'entry' ? '#1f2937' : '#6b7280',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: editMode === 'entry' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              Timeline Entry Data
            </button>
            <button
              onClick={() => setEditMode('media')}
              style={{
                flex: 1,
                padding: '8px 16px',
                border: 'none',
                borderRadius: 6,
                background: editMode === 'media' ? '#fff' : 'transparent',
                color: editMode === 'media' ? '#1f2937' : '#6b7280',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                boxShadow: editMode === 'media' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              Media Item Data
            </button>
          </div>
        </div>

        {/* Entry Form */}
        {editMode === 'entry' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
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
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                  Entry Label
                </label>
                <select
                  value={entryLabel}
                  onChange={e => setEntryLabel(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
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
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Chronological Date (Optional)
              </label>
              <input
                type="datetime-local"
                value={chronologicalDate}
                onChange={e => setChronologicalDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 14
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
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
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 14
                }}
                placeholder="e.g., 'During the Clone Wars', 'Before Episode IV'"
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Importance
              </label>
              <select
                value={importance}
                onChange={e => setImportance(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
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
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Notes
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 14,
                  resize: 'vertical'
                }}
                placeholder="Optional notes about this entry..."
              />
            </div>
          </div>
        )}

        {/* Media Form */}
        {editMode === 'media' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Display Name
              </label>
              <input
                type="text"
                value={mediaDisplayName}
                onChange={e => setMediaDisplayName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 14
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                  Media Type
                </label>
                <select
                  value={mediaType}
                  onChange={e => setMediaType(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    fontSize: 14
                  }}
                >
                  <option value="">Select type...</option>
                  <option value="movie">Movie</option>
                  <option value="tv">TV Series</option>
                  <option value="book">Book</option>
                  <option value="comic">Comic</option>
                  <option value="game">Game</option>
                  <option value="music">Music</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                  Release Date
                </label>
                <input
                  type="text"
                  value={releaseDate}
                  onChange={e => setReleaseDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    fontSize: 14
                  }}
                  placeholder="YYYY-MM-DD"
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Cover Image URL
              </label>
              <input
                type="url"
                value={coverImageUrl}
                onChange={e => setCoverImageUrl(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 14
                }}
                placeholder="https://..."
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Description
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontSize: 14,
                  resize: 'vertical'
                }}
                placeholder="Description of the media item..."
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            marginTop: 16,
            padding: 12,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            color: '#dc2626',
            fontSize: 14
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              background: '#fff',
              color: '#374151',
              fontSize: 14,
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={editMode === 'entry' ? handleSaveEntry : handleSaveMedia}
            disabled={loading}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderRadius: 6,
              background: '#3b82f6',
              color: '#fff',
              fontSize: 14,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}