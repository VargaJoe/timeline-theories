import React, { useEffect, useState } from 'react';
import { getTimelines } from '../services/timelineService';
import type { Timeline } from '../services/timelineService';
import { Link } from 'react-router-dom';

export const TimelineListPage: React.FC = () => {
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    console.log('TimelineListPage: Starting to load timelines...');
    getTimelines()
      .then(timelines => {
        console.log('TimelineListPage: Successfully loaded timelines:', timelines);
        setTimelines(timelines);
      })
      .catch(err => {
        console.error('TimelineListPage: Failed to load timelines:', err);
        setError('Failed to load timelines');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 18, color: '#666' }}>Loading timelines...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ color: '#dc3545', fontSize: 16, marginBottom: 16 }}>{error}</div>
        <button 
          onClick={() => window.location.reload()} 
          style={{
            background: '#2a4d8f',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            cursor: 'pointer'
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ marginBottom: 8, color: '#2a4d8f' }}>Public Timelines</h1>
        <p style={{ color: '#666', margin: 0 }}>
          Discover timelines created by the community, or{' '}
          <Link to="/create" style={{ color: '#2a4d8f', fontWeight: 500 }}>create your own</Link>.
        </p>
      </div>
      
      {timelines.length === 0 ? (
        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: 12,
          padding: 40,
          textAlign: 'center'
        }}>
          <h3 style={{ marginBottom: 16, color: '#495057' }}>No timelines found</h3>
          <p style={{ color: '#6c757d', marginBottom: 24 }}>
            Be the first to create a timeline for the community!
          </p>
          <Link 
            to="/create" 
            style={{
              background: '#2a4d8f',
              color: 'white',
              textDecoration: 'none',
              padding: '12px 24px',
              borderRadius: 6,
              fontWeight: 500,
              display: 'inline-block'
            }}
          >
            Create First Timeline
          </Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {timelines.map(timeline => (
            <div key={timeline.id} style={{
              background: '#fff',
              border: '1px solid #e9ecef',
              borderRadius: 12,
              padding: 24,
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
              transition: 'transform 0.2s, box-shadow 0.2s'
            }}>
              <Link 
                to={`/timelines/${timeline.id}`} 
                style={{ 
                  textDecoration: 'none',
                  color: 'inherit',
                  display: 'block'
                }}
              >
                <h3 style={{ 
                  marginBottom: 8, 
                  color: '#2a4d8f',
                  fontSize: 20,
                  fontWeight: 600
                }}>
                  {timeline.name}
                </h3>
                
                {timeline.description && (
                  <p style={{ 
                    color: '#495057', 
                    marginBottom: 16,
                    lineHeight: 1.5,
                    fontSize: 14
                  }}>
                    {timeline.description}
                  </p>
                )}
                
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 12,
                  color: '#6c757d'
                }}>
                  <span>
                    Sort: {timeline.sort_order === 'chronological' ? 'Chronological' : 'Release Order'}
                  </span>
                  {timeline.created_at && (
                    <span>
                      Created: {new Date(timeline.created_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
