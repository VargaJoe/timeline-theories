import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MediaLibrarySelector } from '../components/MediaLibrarySelector';
import { TimelineEntryService } from '../services/timelineEntryService';
import { timelinesPath } from '../projectPaths';

export default function TimelineEntryCreatePage() {
  const { timelineId: timelineName } = useParams<{ timelineId: string }>();
  const navigate = useNavigate();
  const [selectedMedia, setSelectedMedia] = useState<{ Id: number; DisplayName?: string } | null>(null);
  const [position, setPosition] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [entryLabel, setEntryLabel] = useState('mainstory');
  const [importance, setImportance] = useState('essential');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSelect = (media: { Id: number; DisplayName?: string }) => setSelectedMedia(media);

  const handleSave = async () => {
    if (!timelineName || !selectedMedia) return;
    setSaving(true);
    setError('');
    try {
      // TimelineEntry should be created under the selected timeline's path
      const parentPath = `${timelinesPath}/${timelineName}`;
      await TimelineEntryService.createTimelineEntry({
        mediaItem: selectedMedia,
        position,
        notes,
        entryLabel,
        importance,
      }, parentPath);
      navigate(`/timelines/${timelineName}`);
    } catch (e) {
      setError('Failed to create timeline entry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <h2>Add Media to Timeline</h2>
      {!selectedMedia ? (
        <MediaLibrarySelector onSelect={handleSelect} />
      ) : (
        <div>
          <div style={{ marginBottom: 12 }}>
            <strong>Selected:</strong> {selectedMedia.DisplayName}
            <button style={{ marginLeft: 12 }} onClick={() => setSelectedMedia(null)}>
              Change
            </button>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Position: <input type="number" value={position} min={1} onChange={e => setPosition(Number(e.target.value))} /></label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Notes:<br />
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ width: '100%' }} />
            </label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Entry Label:
              <select value={entryLabel} onChange={e => setEntryLabel(e.target.value)}>
                <option value="mainstory">Main story</option>
                <option value="firstappearance">First appearance</option>
                <option value="flashback">Flashback</option>
                <option value="cameo">Cameo</option>
                <option value="reference">Reference</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>Importance:
              <select value={importance} onChange={e => setImportance(e.target.value)}>
                <option value="essential">Essential</option>
                <option value="important">Important</option>
                <option value="optional">Optional</option>
                <option value="skipok">SkipOk</option>
              </select>
            </label>
          </div>
          {error && <div style={{ color: 'red', marginBottom: 12 }}>{error}</div>}
          <button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Add to Timeline'}
          </button>
        </div>
      )}
    </div>
  );
}
