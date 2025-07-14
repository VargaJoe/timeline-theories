import React, { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { getTimelines } from '../services/timelineService';
import type { Timeline } from '../services/timelineService';
import { Link } from 'react-router-dom';

export const TimelineListPage: React.FC = () => {
  const { oidcUser } = useOidcAuthentication();
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortOrder, setSortOrder] = useState<'alphabetical' | 'created_desc'>('alphabetical');

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
          Discover timelines created by the community.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginTop: 18 }}>
          <div>
            <label htmlFor="timeline-sort" style={{ fontWeight: 500, marginRight: 8 }}>Sort by:</label>
            <select
              id="timeline-sort"
              value={sortOrder}
              onChange={e => setSortOrder(e.target.value as 'alphabetical' | 'created_desc')}
              style={{ padding: 6, borderRadius: 6, border: '1px solid #ccc', fontSize: 15 }}
            >
              <option value="alphabetical">Alphabetical</option>
              <option value="created_desc">Creation Date (Newest on Top)</option>
            </select>
          </div>
          {oidcUser && (
            <Link
              to="/create"
              style={{
                background: '#7bb274',
                color: '#234d32',
                textDecoration: 'none',
                padding: '12px 28px',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 16,
                boxShadow: '0 2px 8px #b7d3b7',
                display: 'inline-block',
                border: 'none',
                transition: 'background 0.2s, color 0.2s',
              }}
              onMouseOver={e => (e.currentTarget.style.background = '#b7d3b7')}
              onMouseOut={e => (e.currentTarget.style.background = '#7bb274')}
            >
              + Create Timeline
            </Link>
          )}
        </div>
      </div>
      
      {/* Sort timelines according to selected order */}
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
          {oidcUser && (
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
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {timelines
            .slice()
            .sort((a, b) => {
              if (sortOrder === 'alphabetical') {
                return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
              } else if (sortOrder === 'created_desc') {
                // Newest first
                return (b.created_at ? new Date(b.created_at).getTime() : 0) - (a.created_at ? new Date(a.created_at).getTime() : 0);
              }
              return 0;
            })
            .map(timeline => {
            // Use the Name field for the URL path segment (friendly URL)
            // If you want to keep the original name formatting, you may need to store the path segment separately
            // For now, we will generate it from the DisplayName (same as in createTimeline)
            const pathSegment = timeline.name.toLowerCase();
            return (
              <div key={timeline.id} style={{
                background: '#fff',
                border: '1px solid #e9ecef',
                borderRadius: 12,
                padding: 24,
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}>
                <Link 
                  to={`/timelines/${pathSegment}`} 
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
                    {timeline.displayName}
                  </h3>
                  {timeline.description && (
                    <div
                      style={{ 
                        color: '#495057', 
                        marginBottom: 16,
                        lineHeight: 1.5,
                        fontSize: 14
                      }}
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(timeline.description) }}
                    />
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
            );
          })}
        </div>
      )}
    </div>
  );
};
