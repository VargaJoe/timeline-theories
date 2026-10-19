import React, { useState, useEffect, useRef } from 'react';
import { MediaLibraryService } from '../services/mediaLibraryService';
import type { MediaItem } from '../services/mediaLibraryService';
import { captureOperationContext } from '../services/sensenet';
import { useSharedAuth } from '../context/useSharedAuth';
import { usePermissions } from '../hooks/usePermissions';
import { mediaLibraryPath } from '../projectPaths';

interface MediaLibrarySelectorProps {
  onSelect: (mediaItem: MediaItem) => void;
  disabledIds?: number[];
}

export const MediaLibrarySelector: React.FC<MediaLibrarySelectorProps> = ({ onSelect, disabledIds = [] }) => {
  const auth = useSharedAuth();
  const canRead = usePermissions([{ target: mediaLibraryPath, action: 'read' }]);
  const readIdentity = JSON.stringify([auth.accessToken, auth.user?.Id, auth.user?.sub]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [nextSkip, setNextSkip] = useState(0);
  const requestGeneration = useRef(0);
  const pageSize = 50;

  useEffect(() => {
    const generation = ++requestGeneration.current, checkContext = captureOperationContext();
    let active = true;
    setMediaItems([]); setHasMore(false); setNextSkip(0); setLoadedIdentity(''); setError(''); setLoading(true);
    if (!canRead) return () => { active = false; };
    const timer = setTimeout(() => {
      MediaLibraryService.getMediaItems(undefined, search, 0, pageSize).then(items => {
        checkContext();
        if (!active || requestGeneration.current !== generation) return;
        setMediaItems(items); setNextSkip(items.length); setHasMore(items.length === pageSize); setLoadedIdentity(readIdentity);
      }).catch(() => {
        if (active && requestGeneration.current === generation) { setMediaItems([]); setError('Failed to load media items.'); }
      }).finally(() => { if (active && requestGeneration.current === generation) setLoading(false); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [search, readIdentity, canRead]);

  const loadMore = async () => {
    const generation = requestGeneration.current, checkContext = captureOperationContext();
    setLoading(true); setError('');
    try {
      const items = await MediaLibraryService.getMediaItems(undefined, search, nextSkip, pageSize);
      checkContext();
      if (requestGeneration.current !== generation) return;
      setMediaItems(previous => [...previous, ...items]); setNextSkip(nextSkip + items.length); setHasMore(items.length === pageSize);
    } catch {
      if (requestGeneration.current === generation) { setMediaItems([]); setLoadedIdentity(''); setHasMore(false); setError('Failed to load media items.'); }
    } finally { if (requestGeneration.current === generation) setLoading(false); }
  };

  const filtered = (loadedIdentity === readIdentity && canRead ? mediaItems : []).filter(item =>
    item.DisplayName.toLowerCase().includes(search.toLowerCase())
  );

  if (!canRead) return <div role="status">This media library is unavailable with your current permissions.</div>;

  return (
    <div>
      <input
        type="text"
        placeholder="Search media..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: 12, width: '100%' }}
      />
      {loading && <div role="status">Loading media library...</div>}
      {error && <div role="status" style={{ color: 'red' }}>{error}</div>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {filtered.map(item => (
          <li key={item.Id} style={{ marginBottom: 8, display: 'flex', alignItems: 'center' }}>
            <span style={{ flex: 1 }}>{item.DisplayName}</span>
            <button
              onClick={() => onSelect(item)}
              disabled={loading || disabledIds.includes(item.Id)}
              style={{ marginLeft: 8 }}
            >
              Select
            </button>
          </li>
        ))}
      </ul>
      {hasMore && <button onClick={loadMore} disabled={loading}>Load more</button>}
    </div>
  );
};
