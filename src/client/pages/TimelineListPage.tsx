import React, { useEffect, useState } from 'react';
import { getTimelines } from '../services/timelineService';
import type { Timeline } from '../services/timelineService';
import { Link } from 'react-router-dom';

export const TimelineListPage: React.FC = () => {
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getTimelines()
      .then(setTimelines)
      .catch(() => setError('Failed to load timelines'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading timelines...</div>;
  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  return (
    <div>
      <h2>Public Timelines</h2>
      {timelines.length === 0 ? (
        <div>No timelines found.</div>
      ) : (
        <ul style={{ padding: 0, listStyle: 'none' }}>
          {timelines.map(t => (
            <li key={t.id} style={{ marginBottom: 16, border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
              <Link to={`/timelines/${t.id}`} style={{ fontWeight: 'bold', fontSize: 18, textDecoration: 'none', color: '#2a4d8f' }}>{t.name}</Link>
              {t.description && <div style={{ color: '#555', marginTop: 4 }}>{t.description}</div>}
              <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Sort order: {t.sort_order}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
