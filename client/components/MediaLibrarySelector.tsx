import React, { useState, useEffect } from 'react';
import { MediaLibraryService } from '../services/mediaLibraryService';
import type { MediaItem } from '../services/mediaLibraryService';

interface MediaLibrarySelectorProps {
  onSelect: (mediaItem: MediaItem) => void;
  disabledIds?: number[];
}

export const MediaLibrarySelector: React.FC<MediaLibrarySelectorProps> = ({ onSelect, disabledIds = [] }) => {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    MediaLibraryService.getMediaItems().then(setMediaItems).catch(() => setError('Failed to load media items.')).finally(() => setLoading(false));
  }, []);

  const filtered = mediaItems.filter(item =>
    item.DisplayName.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div>Loading media library...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  return (
    <div>
      <input
        type="text"
        placeholder="Search media..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 12, width: '100%' }}
      />
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {filtered.map(item => (
          <li key={item.Id} style={{ marginBottom: 8, display: 'flex', alignItems: 'center' }}>
            <span style={{ flex: 1 }}>{item.DisplayName}</span>
            <button
              onClick={() => onSelect(item)}
              disabled={disabledIds.includes(item.Id)}
              style={{ marginLeft: 8 }}
            >
              Select
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
