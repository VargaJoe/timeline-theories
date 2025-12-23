import React, { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { useSharedAuth } from '../context/useSharedAuth';
import { getTimelines, getTimelineMediaCovers } from '../services/timelineService';
import type { Timeline } from '../services/timelineService';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { MediaCoverMontage } from '../components/MediaCoverMontage';
import { loadBackgroundImage } from '../services/sensenet';
import { siteConfig } from '../configuration';
import { timelinesPath } from '../projectPaths';

export const TimelineListPage: React.FC = () => {
  // Handle authentication state - unified auth context
  const { user } = useSharedAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [mediaCovers, setMediaCovers] = useState<Record<string, string[]>>({});
  const [sortOrder, setSortOrder] = useState<'alphabetical' | 'created_desc'>(() => {
    // Get sort order from localStorage or default to alphabetical
    const saved = localStorage.getItem('timeline-sort-order');
    return (saved === 'alphabetical' || saved === 'created_desc') ? saved : 'alphabetical';
  });
  const [characterFilter, setCharacterFilter] = useState<string>('');
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  
  // Pagination state for "All" view
  const [loadedTimelines, setLoadedTimelines] = useState<Timeline[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const handleSortOrderChange = (newSortOrder: 'alphabetical' | 'created_desc') => {
    setSortOrder(newSortOrder);
    localStorage.setItem('timeline-sort-order', newSortOrder);
  };

  const handleCharacterFilterChange = (character: string) => {
    setCharacterFilter(character);
    setLoading(true); // Show loading while fetching new data
    // Reset pagination state when changing filters
    setLoadedTimelines([]);
    setHasMore(false);
    setLoadingMore(false);
    
    // Update URL parameter
    const newParams = new URLSearchParams(searchParams);
    if (character === '') {
      newParams.set('filter', 'all');
    } else {
      newParams.set('filter', character);
    }
    setSearchParams(newParams);
  };

  const loadMoreTimelines = async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    try {
      const currentCount = loadedTimelines.length;
      const newTimelines = await getTimelines(
        !!user, 
        characterFilter, 
        currentCount, 
        siteConfig.timelineList.allViewPageSize,
        sortOrder
      );
      
      if (newTimelines.length > 0) {
        setLoadedTimelines(prev => [...prev, ...newTimelines]);
        setHasMore(newTimelines.length === siteConfig.timelineList.allViewPageSize);
        
        // Fetch media covers for new timelines
        const covers: Record<string, string[]> = {};
        for (const timeline of newTimelines) {
          try {
            const timelinePath = `${timelinesPath}/${timeline.name}`;
            const timelineCovers = await getTimelineMediaCovers(timelinePath, 4);
            covers[timeline.id] = timelineCovers;
          } catch (error) {
            console.error(`Failed to load covers for timeline ${timeline.name}:`, error);
            covers[timeline.id] = [];
          }
        }
        setMediaCovers(prev => ({ ...prev, ...covers }));
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Failed to load more timelines:', error);
      setError('Failed to load more timelines');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!isInitialized) return;
    
    console.log('TimelineListPage: Starting to load timelines...');
    
    // For "All" view, use pagination
    if (characterFilter === '') {
      getTimelines(!!user, characterFilter, 0, siteConfig.timelineList.allViewPageSize, sortOrder)
        .then(timelines => {
          console.log('TimelineListPage: Successfully loaded initial timelines:', timelines);
          setLoadedTimelines(timelines);
          setHasMore(timelines.length === siteConfig.timelineList.allViewPageSize);
          
          // Fetch media covers for each timeline
          const fetchMediaCovers = async () => {
            const covers: Record<string, string[]> = {};
            for (const timeline of timelines) {
              try {
                const timelinePath = `${timelinesPath}/${timeline.name}`;
                const timelineCovers = await getTimelineMediaCovers(timelinePath, 4);
                covers[timeline.id] = timelineCovers;
              } catch (error) {
                console.error(`Failed to load covers for timeline ${timeline.name}:`, error);
                covers[timeline.id] = [];
              }
            }
            setMediaCovers(covers);
          };
          
          fetchMediaCovers();
        })
        .catch(err => {
          console.error('TimelineListPage: Failed to load timelines:', err);
          setError('Failed to load timelines');
        })
        .finally(() => setLoading(false));
    } else {
      // For character-filtered views, load initial page
      getTimelines(!!user, characterFilter, 0, siteConfig.timelineList.allViewPageSize, sortOrder)
        .then(timelines => {
          console.log('TimelineListPage: Successfully loaded timelines:', timelines);
          setLoadedTimelines(timelines);
          setHasMore(timelines.length === siteConfig.timelineList.allViewPageSize);
          
          // Fetch media covers for each timeline
          const fetchMediaCovers = async () => {
            const covers: Record<string, string[]> = {};
            for (const timeline of timelines) {
              try {
                const timelinePath = `${timelinesPath}/${timeline.name}`;
                const timelineCovers = await getTimelineMediaCovers(timelinePath, 4);
                covers[timeline.id] = timelineCovers;
              } catch (error) {
                console.error(`Failed to load covers for timeline ${timeline.name}:`, error);
                covers[timeline.id] = [];
              }
            }
            setMediaCovers(covers);
          };
          
          fetchMediaCovers();
        })
        .catch(err => {
          console.error('TimelineListPage: Failed to load timelines:', err);
          setError('Failed to load timelines');
        })
        .finally(() => setLoading(false));
    }
  }, [characterFilter, sortOrder, isInitialized]);

  // Sync characterFilter with URL parameters
  useEffect(() => {
    if (!siteConfig.timelineList.enableAbcPagination) {
      if (characterFilter !== '') {
        setCharacterFilter('');
      }
      setIsInitialized(true);
      return;
    }
    
    const filterParam = searchParams.get('filter');
    let expectedFilter = 'a'; // Default
    if (filterParam === 'all') {
      expectedFilter = '';
    } else if (filterParam && filterParam.length === 1) {
      expectedFilter = filterParam;
    }
    
    if (characterFilter !== expectedFilter) {
      setCharacterFilter(expectedFilter);
      setLoading(true);
      setLoadedTimelines([]);
      setHasMore(false);
      setLoadingMore(false);
    }
    setIsInitialized(true);
  }, [searchParams, siteConfig.timelineList.enableAbcPagination]);

  // Load background image from SenseNet
  useEffect(() => {
    const loadBackground = async () => {
      try {
        const imageUrl = await loadBackgroundImage(siteConfig.headerBackgroundImagePath);
        if (imageUrl) {
          console.log('[TimelineListPage] Background image loaded:', imageUrl);
          
          // Test if the image can be loaded by creating an Image object
          const testImage = new Image();
          testImage.onload = () => {
            console.log('[TimelineListPage] Background image successfully tested');
            setBackgroundImageUrl(imageUrl);
          };
          testImage.onerror = (error) => {
            console.error('[TimelineListPage] Background image failed to load:', error);
            console.log('[TimelineListPage] Falling back to gradient background');
            setBackgroundImageUrl(null); // This will trigger gradient fallback in PageHeader
          };
          testImage.src = imageUrl;
        } else {
          console.warn('[TimelineListPage] No background image URL received, using gradient fallback');
          setBackgroundImageUrl(null); // This will trigger gradient fallback in PageHeader
        }
      } catch (error) {
        console.error('[TimelineListPage] Error loading background image:', error);
        setBackgroundImageUrl(null); // This will trigger gradient fallback in PageHeader
      }
    };
    
    loadBackground();
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
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
      <PageHeader 
        title="Timeline Library" 
        subtitle="Discover chronological timelines for your favorite universes"
        backgroundImage={backgroundImageUrl || undefined}
        overlayOpacity={siteConfig.headerOverlayOpacity}
        showSiteTitle={false}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          {/* ABC Navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500, color: '#fff', marginRight: 8 }}>Browse:</span>
            {siteConfig.timelineList.enableAllView && (
              <button
                onClick={() => handleCharacterFilterChange('')}
                style={{
                  background: characterFilter === '' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  border: characterFilter === '' ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  minWidth: 32,
                  textAlign: 'center'
                }}
                onMouseOver={e => {
                  if (characterFilter !== '') {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                  }
                }}
                onMouseOut={e => {
                  if (characterFilter !== '') {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                  }
                }}
              >
                All
              </button>
            )}
            {siteConfig.timelineList.enableAbcPagination && ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map(char => (
              <button
                key={char}
                onClick={() => handleCharacterFilterChange(char.toLowerCase())}
                style={{
                  background: characterFilter === char.toLowerCase() ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  border: characterFilter === char.toLowerCase() ? '1px solid rgba(255,255,255,0.5)' : '1px solid rgba(255,255,255,0.3)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  minWidth: 32,
                  textAlign: 'center'
                }}
                onMouseOver={e => {
                  if (characterFilter !== char.toLowerCase()) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                  }
                }}
                onMouseOut={e => {
                  if (characterFilter !== char.toLowerCase()) {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                  }
                }}
              >
                {char}
              </button>
            ))}
          </div>

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
              {siteConfig.timelineList.enableAllView && characterFilter === '' && (
                <option value="created_desc" style={{ color: '#333' }}>Newest First</option>
              )}
            </select>
          </div>
          {user && (
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
        {(loadedTimelines.length === 0) ? (
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
              It looks like there are no timelines available yet. 
            </p>
            {user && (
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
          <>
            <div 
              className="timeline-list-grid"
              style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', 
                gap: 24,
                maxWidth: '100%'
              }}
            >
              {loadedTimelines
                .slice()
                // Filter out private timelines unless user is logged in (admin) - server-side filtering now handles character filter
                .filter(timeline => timeline.isVisible !== false || user)
              .map(timeline => {
                const pathSegment = timeline.name.toLowerCase();
                return (
                  <div key={timeline.id} style={{
                    background: '#fff',
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                    height: 420, // Fixed height for consistent layout
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative'
                  }}>
                    <Link 
                      to={`/timelines/${pathSegment}`} 
                      style={{ 
                        textDecoration: 'none',
                        color: 'inherit',
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%'
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
                    {/* PRIVATE indicator if not public */}
                    {timeline.isVisible === false && (
                      <div style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        background: '#ffc107',
                        color: '#212529',
                        padding: '4px 10px',
                        borderRadius: 6,
                        fontWeight: 700,
                        fontSize: 13,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.10)',
                        zIndex: 2
                      }}>
                        PRIVATE
                      </div>
                    )}
                      {/* Cover Image */}
                      <div style={{
                        height: 200,
                        flexShrink: 0, // Prevent shrinking
                        backgroundImage: timeline.coverImageUrl 
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
                          <MediaCoverMontage 
                            coverUrls={mediaCovers[timeline.id] || []}
                            timelineName={timeline.displayName}
                          />
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
                      <div style={{ 
                        padding: 20,
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column'
                      }}>
                        <h3 style={{ 
                          marginBottom: 12, 
                          color: '#2a4d8f',
                          fontSize: 20,
                          fontWeight: 600,
                          lineHeight: 1.3
                        }}>
                          {timeline.displayName}
                        </h3>
                        
                        <div style={{ flex: 1 }}>
                          {timeline.description && (
                            <div
                              style={{ 
                                color: '#495057', 
                                marginBottom: 16,
                                lineHeight: 1.5,
                                fontSize: 14,
                                overflow: 'hidden',
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                maxHeight: 63 // 3 lines × 14px × 1.5 line-height = 63px
                              }}
                              dangerouslySetInnerHTML={{
                                __html: DOMPurify.sanitize(
                                  timeline.description.length > 80
                                    ? timeline.description.slice(0, 80) + '...'
                                    : timeline.description
                                )
                              }}
                            />
                          )}
                        </div>
                        
                        <div style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 12,
                          color: '#6c757d',
                          borderTop: '1px solid #f0f0f0',
                          paddingTop: 12,
                          marginTop: 'auto'
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

            {/* Load More button */}
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 40, marginBottom: 20 }}>
                <button
                  onClick={loadMoreTimelines}
                  disabled={loadingMore}
                  style={{
                    background: loadingMore ? '#6c757d' : '#2a4d8f',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '16px 32px',
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: loadingMore ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: loadingMore ? 'none' : '0 4px 12px rgba(42, 77, 143, 0.3)',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={e => {
                    if (!loadingMore) {
                      e.currentTarget.style.background = '#1e3b73';
                      e.currentTarget.style.boxShadow = '0 6px 16px rgba(42, 77, 143, 0.4)';
                    }
                  }}
                  onMouseOut={e => {
                    if (!loadingMore) {
                      e.currentTarget.style.background = '#2a4d8f';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(42, 77, 143, 0.3)';
                    }
                  }}
                >
                  {loadingMore ? (
                    <>
                      <div style={{
                        width: 16,
                        height: 16,
                        border: '2px solid #fff',
                        borderTop: '2px solid transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }}></div>
                      Loading...
                    </>
                  ) : (
                    <>
                      Load More Timelines
                      <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ABC Navigation at bottom */}
      <div style={{ maxWidth: 1200, margin: '20px auto 0 auto', padding: '0 20px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#f8f9fa', padding: '16px 24px', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <span style={{ fontWeight: 500, color: '#495057', marginRight: 8 }}>Browse:</span>
          {siteConfig.timelineList.enableAllView && (
            <button
              onClick={() => handleCharacterFilterChange('')}
              style={{
                background: characterFilter === '' ? '#2a4d8f' : '#fff',
                color: characterFilter === '' ? '#fff' : '#495057',
                border: characterFilter === '' ? '1px solid #2a4d8f' : '1px solid #dee2e6',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
                minWidth: 36,
                textAlign: 'center',
                boxShadow: characterFilter === '' ? '0 2px 4px rgba(42, 77, 143, 0.2)' : 'none'
              }}
              onMouseOver={e => {
                if (characterFilter !== '') {
                  e.currentTarget.style.background = '#f8f9fa';
                  e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                }
              }}
              onMouseOut={e => {
                if (characterFilter !== '') {
                  e.currentTarget.style.background = '#fff';
                  e.currentTarget.style.boxShadow = 'none';
                }
              }}
            >
              All
            </button>
          )}
          {['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map(char => (
            <button
              key={char}
              onClick={() => handleCharacterFilterChange(char.toLowerCase())}
              style={{
                background: characterFilter === char.toLowerCase() ? '#2a4d8f' : '#fff',
                color: characterFilter === char.toLowerCase() ? '#fff' : '#495057',
                border: characterFilter === char.toLowerCase() ? '1px solid #2a4d8f' : '1px solid #dee2e6',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
                minWidth: 36,
                textAlign: 'center',
                boxShadow: characterFilter === char.toLowerCase() ? '0 2px 4px rgba(42, 77, 143, 0.2)' : 'none'
              }}
              onMouseOver={e => {
                if (characterFilter !== char.toLowerCase()) {
                  e.currentTarget.style.background = '#f8f9fa';
                  e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                }
              }}
              onMouseOut={e => {
                if (characterFilter !== char.toLowerCase()) {
                  e.currentTarget.style.background = '#fff';
                  e.currentTarget.style.boxShadow = 'none';
                }
              }}
            >
              {char}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};
