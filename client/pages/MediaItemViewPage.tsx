import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import type { MediaItem } from '../services/mediaLibraryService';
import { MediaLibraryService } from '../services/mediaLibraryService';

export const MediaItemViewPage: React.FC = () => {
  const navigate = useNavigate();
  const { id: mediaName } = useParams();
  const [mediaItem, setMediaItem] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!mediaName) return;
    const loadMediaItem = async () => {
      try {
        setLoading(true);
        const item = await MediaLibraryService.getMediaItemByName(mediaName);
        setMediaItem(item);
      } catch (err) {
        console.error('Failed to load media item:', err);
        setError('Failed to load media item');
      } finally {
        setLoading(false);
      }
    };
    loadMediaItem();
  }, [mediaName]);

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  };

  const getExternalLinks = (externalLinksJson?: string) => {
    if (!externalLinksJson) return {};
    try {
      const links = JSON.parse(externalLinksJson);
      const processedLinks: Record<string, string> = {};
      
      for (const [key, value] of Object.entries(links)) {
        if (typeof value === 'string' || typeof value === 'number') {
          // Convert IDs to proper URLs
          switch (key.toLowerCase()) {
            case 'imdb':
              processedLinks['IMDb'] = `https://www.imdb.com/title/${value}/`;
              break;
            case 'tmdb':
              processedLinks['TMDb'] = `https://www.themoviedb.org/movie/${value}`;
              break;
            case 'trakt':
              processedLinks['Trakt'] = `https://trakt.tv/movies/${value}`;
              break;
            case 'tvdb':
              processedLinks['TVDB'] = `https://www.thetvdb.com/?tab=series&id=${value}`;
              break;
            default:
              // If it's already a URL, use it as is
              if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
                processedLinks[key] = value;
              } else {
                // Otherwise, treat as an ID and create a generic link
                processedLinks[key] = `https://example.com/${key}/${value}`;
              }
              break;
          }
        }
      }
      
      return processedLinks;
    } catch {
      // If it's a single URL string, return it
      if (typeof externalLinksJson === 'string' && (externalLinksJson.startsWith('http://') || externalLinksJson.startsWith('https://'))) {
        return { 'External Link': externalLinksJson };
      }
      return {};
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <svg style={{ animation: 'spin 1s linear infinite', height: 48, width: 48, color: '#2a4d8f', margin: '0 auto 16px' }} fill="none" viewBox="0 0 24 24">
            <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p style={{ color: '#666' }}>Loading media item...</p>
        </div>
      </div>
    );
  }

  if (error || !mediaItem) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <svg style={{ width: 64, height: 64, color: '#dc3545', margin: '0 auto 16px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h1 style={{ fontSize: 24, fontWeight: 'bold', color: '#333', marginBottom: 8 }}>Media Item Not Found</h1>
          <p style={{ color: '#666', marginBottom: 16 }}>{error || 'The media item you are looking for does not exist.'}</p>
          <Link 
            to="/media-library" 
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '8px 16px',
              background: '#2a4d8f',
              color: '#fff',
              textDecoration: 'none',
              borderRadius: 6,
              fontWeight: 500,
              fontSize: 14,
              gap: 8
            }}
          >
            <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Media Library
          </Link>
        </div>
      </div>
    );
  }

  const externalLinks = getExternalLinks(mediaItem.ExternalLinks);

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', padding: 32 }}>
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 2) {
                window.history.back();
              } else {
                navigate('/media-library');
              }
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              color: '#2a4d8f',
              background: 'none',
              border: 'none',
              textDecoration: 'none',
              marginBottom: 16,
              fontSize: 14,
              gap: 8,
              cursor: 'pointer',
              fontWeight: 500,
              padding: 0
            }}
          >
            <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 12px #0001', padding: 32 }}>
            <h1 style={{ fontSize: 32, fontWeight: 'bold', color: '#2a4d8f', marginBottom: 16 }}>
              {mediaItem.DisplayName}
            </h1>
            
            {/* Media Type Badge */}
            <div style={{ marginBottom: 24 }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: 14,
                fontWeight: 500,
                background: '#e3f2fd',
                color: '#1976d2'
              }}>
                {mediaItem.MediaType}
              </span>
              {mediaItem.Genre && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '6px 12px',
                  borderRadius: 20,
                  fontSize: 14,
                  fontWeight: 500,
                  background: '#f5f5f5',
                  color: '#666',
                  marginLeft: 8
                }}>
                  {mediaItem.Genre}
                </span>
              )}
            </div>

            {/* Release Date */}
            {mediaItem.ReleaseDate && (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: '#333', marginBottom: 8 }}>Release Date</h2>
                <p style={{ color: '#666', fontSize: 16 }}>{formatDate(mediaItem.ReleaseDate)}</p>
              </div>
            )}

            {/* Description */}
            {mediaItem.Description && (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: '#333', marginBottom: 8 }}>Description</h2>
                <p style={{ color: '#666', lineHeight: 1.6, fontSize: 16 }}>{mediaItem.Description}</p>
              </div>
            )}

            {/* Cover Image */}
            {mediaItem.CoverImageUrl && (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: '#333', marginBottom: 8 }}>Cover Image</h2>
                <img 
                  src={mediaItem.CoverImageUrl} 
                  alt={mediaItem.DisplayName}
                  style={{ maxWidth: 200, height: 'auto', borderRadius: 8, boxShadow: '0 2px 8px #0001' }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            )}

            {/* Tags */}
            {mediaItem.Tags && (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: '#333', marginBottom: 8 }}>Tags</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {mediaItem.Tags.split(',').map((tag: string, index: number) => (
                    <span 
                      key={index}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontSize: 14,
                        background: '#e9ecef',
                        color: '#495057'
                      }}
                    >
                      #{tag.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* External Links */}
            {Object.keys(externalLinks).length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: '#333', marginBottom: 8 }}>External Links</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(externalLinks).map(([key, url]) => (
                    <a
                      key={key}
                      href={url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        color: '#2a4d8f',
                        textDecoration: 'none',
                        fontSize: 16,
                        gap: 8
                      }}
                    >
                      <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      {key === 'url' ? 'External Link' : key.charAt(0).toUpperCase() + key.slice(1)}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div style={{ borderTop: '1px solid #e9ecef', paddingTop: 24, fontSize: 14, color: '#6c757d' }}>
              <p style={{ marginBottom: 4 }}>Created: {formatDate(mediaItem.CreationDate)}</p>
              <p>ID: {mediaItem.Id}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
