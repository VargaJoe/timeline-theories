import React, { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { getTimelines } from '../services/timelineService';
import type { Timeline } from '../services/timelineService';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';

export const TimelineListPage: React.FC = () => {
  const { oidcUser } = useOidcAuthentication();
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortOrder, setSortOrder] = useState<'alphabetical' | 'created_desc'>(() => {
    // Get sort order from localStorage or default to alphabetical
    const saved = localStorage.getItem('timeline-sort-order');
    return (saved === 'alphabetical' || saved === 'created_desc') ? saved : 'alphabetical';
  });

  const handleSortOrderChange = (newSortOrder: 'alphabetical' | 'created_desc') => {
    setSortOrder(newSortOrder);
    localStorage.setItem('timeline-sort-order', newSortOrder);
  };

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
    <>
      <PageHeader 
        title="Timeline Library" 
        subtitle="Discover community-created chronological timelines for your favorite universes"
        backgroundImage="/temp/background.webp"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <label htmlFor="timeline-sort" style={{ fontWeight: 500, color: '#fff' }}>Sort by:</label>
            <select
              id="timeline-sort"
              value={sortOrder}
              onChange={e => handleSortOrderChange(e.target.value as 'alphabetical' | 'created_desc')}
              style={{ 
                padding: '8px 12px', 
                borderRadius: 6, 
                border: '1px solid rgba(255,255,255,0.3)', 
                fontSize: 15,
                background: 'rgba(255,255,255,0.1)',
                color: '#fff'
              }}
            >
              <option value="alphabetical" style={{ color: '#333' }}>Alphabetical</option>
              <option value="created_desc" style={{ color: '#333' }}>Newest First</option>
            </select>
          </div>
          {oidcUser && (
            <Link
              to="/create"
              style={{
                background: 'rgba(255,255,255,0.2)',
                color: '#fff',
                textDecoration: 'none',
                padding: '12px 24px',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: 16,
                border: '1px solid rgba(255,255,255,0.3)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                transition: 'background 0.2s'
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.3)')}
              onMouseOut={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Timeline
            </Link>
          )}
        </div>
      </PageHeader>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px 40px 20px' }}>
        {timelines.length === 0 ? (
          <div style={{
            background: '#fff',
            border: '1px solid #e9ecef',
            borderRadius: 12,
            padding: 60,
            textAlign: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
          }}>
            <h3 style={{ marginBottom: 16, color: '#495057', fontSize: 24 }}>No timelines found</h3>
            <p style={{ color: '#6c757d', marginBottom: 32, fontSize: 16 }}>
              Be the first to create a timeline for the community!
            </p>
            {oidcUser && (
              <Link 
                to="/create" 
                style={{
                  background: '#2a4d8f',
                  color: 'white',
                  textDecoration: 'none',
                  padding: '16px 32px',
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 18,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 12px rgba(42, 77, 143, 0.3)'
                }}
              >
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create First Timeline
              </Link>
            )}
          </div>
        ) : (
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', 
            gap: 24 
          }}>
            {timelines
              .slice()
              .sort((a, b) => {
                if (sortOrder === 'alphabetical') {
                  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
                } else if (sortOrder === 'created_desc') {
                  return (b.created_at ? new Date(b.created_at).getTime() : 0) - (a.created_at ? new Date(a.created_at).getTime() : 0);
                }
                return 0;
              })
              .map(timeline => {
                const pathSegment = timeline.name.toLowerCase();
                return (
                  <div key={timeline.id} style={{
                    background: '#fff',
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    transition: 'transform 0.2s, box-shadow 0.2s'
                  }}>
                    <Link 
                      to={`/timelines/${pathSegment}`} 
                      style={{ 
                        textDecoration: 'none',
                        color: 'inherit',
                        display: 'block'
                      }}
                      onMouseOver={(e) => {
                        e.currentTarget.parentElement!.style.transform = 'translateY(-2px)';
                        e.currentTarget.parentElement!.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
                      }}
                      onMouseOut={(e) => {
                        e.currentTarget.parentElement!.style.transform = 'translateY(0)';
                        e.currentTarget.parentElement!.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
                      }}
                    >
                      {/* Cover Image */}
                      <div style={{
                        height: 200,
                        background: timeline.coverImageUrl 
                          ? `url(${timeline.coverImageUrl})` 
                          : 'linear-gradient(135deg, #2a4d8f 0%, #1e3b73 100%)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative'
                      }}>
                        {!timeline.coverImageUrl && (
                          <svg width="48" height="48" fill="none" stroke="rgba(255,255,255,0.7)" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )}
                        <div style={{
                          position: 'absolute',
                          bottom: 12,
                          right: 12,
                          background: 'rgba(0,0,0,0.6)',
                          color: '#fff',
                          padding: '4px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 500
                        }}>
                          {timeline.sort_order === 'chronological' ? 'Chronological' : 'Release Order'}
                        </div>
                      </div>
                      
                      {/* Card Content */}
                      <div style={{ padding: 20 }}>
                        <h3 style={{ 
                          marginBottom: 12, 
                          color: '#2a4d8f',
                          fontSize: 20,
                          fontWeight: 600,
                          lineHeight: 1.3,
                          minHeight: 48 // Ensure consistent height
                        }}>
                          {timeline.displayName}
                        </h3>
                        
                        {timeline.description && (
                          <div
                            style={{ 
                              color: '#495057', 
                              marginBottom: 16,
                              lineHeight: 1.5,
                              fontSize: 14,
                              minHeight: 60, // Ensure consistent height
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical'
                            }}
                            dangerouslySetInnerHTML={{
                              __html: DOMPurify.sanitize(
                                timeline.description.length > 120
                                  ? timeline.description.slice(0, 120) + '...'
                                  : timeline.description
                              )
                            }}
                          />
                        )}
                        
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 12,
                          color: '#6c757d',
                          borderTop: '1px solid #f0f0f0',
                          paddingTop: 12,
                          marginTop: 12
                        }}>
                          <span style={{
                            background: '#f8f9fa',
                            padding: '4px 8px',
                            borderRadius: 4,
                            fontWeight: 500
                          }}>
                            Timeline
                          </span>
                          {timeline.created_at && (
                            <span>
                              {new Date(timeline.created_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </>
  );
};
