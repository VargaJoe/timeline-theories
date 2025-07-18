import React, { useState, useEffect } from 'react';
import { PageHeader } from '../components/PageHeader';
import { siteConfig } from '../configuration';
import { loadBackgroundImage } from '../services/sensenet';
import { useParams, Link, useNavigate } from 'react-router-dom';
import type { MediaItem } from '../services/mediaLibraryService';
import { MediaLibraryService } from '../services/mediaLibraryService';

export const MediaItemViewPage: React.FC = () => {
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  // Load background image (same as timeline pages)
  useEffect(() => {
    const loadBackground = async () => {
      try {
        const imageUrl = await loadBackgroundImage(siteConfig.headerBackgroundImagePath);
        if (imageUrl) {
          // Test if the image can be loaded by creating an Image object
          const testImage = new window.Image();
          testImage.onload = () => setBackgroundImageUrl(imageUrl);
          testImage.onerror = () => setBackgroundImageUrl(null);
          testImage.src = imageUrl;
        } else {
          setBackgroundImageUrl(null);
        }
      } catch {
        setBackgroundImageUrl(null);
      }
    };
    loadBackground();
  }, []);
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

  // Header formatting logic
  let headerTitle = mediaItem.DisplayName;
  let headerSubtitle = '';
  // Normalize MediaType to string for robust comparison
  let mediaTypeStr = '';
  if (Array.isArray(mediaItem.MediaType)) {
    mediaTypeStr = mediaItem.MediaType[0] || '';
  } else if (typeof mediaItem.MediaType === 'string') {
    mediaTypeStr = mediaItem.MediaType;
  }
  mediaTypeStr = mediaTypeStr.toLowerCase();

  if (mediaTypeStr === 'tvepisode') {
    // Try to extract season/episode from DisplayName or Genre
    // Example: "Series Title: Season 2" (subtitle), "2x03 Episode Title (2021)" (title)
    // If DisplayName is "2x03 Episode Title", try to split
    const match = mediaItem.DisplayName.match(/^(\d+x\d+)\s+(.+?)(\s+\((\d{4})\))?$/);
    if (match) {
      headerTitle = match[2] + (match[4] ? ` (${match[4]})` : '');
      headerSubtitle = `${mediaItem.Genre ? mediaItem.Genre + ': ' : ''}${match[1]}`;
    } else {
      headerTitle = mediaItem.DisplayName;
      headerSubtitle = mediaItem.Genre || '';
    }
  } else if (mediaTypeStr === 'movie') {
    // Movie: "MovieTitle (year)"
    const year = mediaItem.ReleaseDate ? ` (${new Date(mediaItem.ReleaseDate).getFullYear()})` : '';
    headerTitle = mediaItem.DisplayName; // + year;
    headerSubtitle = '';
  }

  return (
    <>
      <PageHeader
        title={headerTitle}
        subtitle={headerSubtitle}
        backgroundImage={backgroundImageUrl || undefined}
        overlayOpacity={siteConfig.headerOverlayOpacity}
      />
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '0 20px 24px 20px'
      }}>
        {/* Back Button */}
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
            color: '#2563eb',
            background: 'none',
            border: 'none',
            textDecoration: 'none',
            marginBottom: 20,
            fontSize: 15,
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
        <div style={{
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 2px 12px #0001',
          padding: 0,
          display: 'flex',
          flexDirection: 'row',
          gap: 0,
          overflow: 'hidden',
          minHeight: 320
        }}>
          {/* Cover Image or Fallback */}
          <div style={{
            width: 260,
            minWidth: 200,
            background: 'linear-gradient(135deg, #f3f4f6, #e5e7eb)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {mediaItem.CoverImageUrl ? (
              <img
                src={mediaItem.CoverImageUrl}
                alt={mediaItem.DisplayName}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transition: 'transform 0.3s ease',
                  borderRadius: 0
                }}
                onError={e => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              />
            ) : (
              <div style={{
                width: '100%',
                height: 260,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af',
              }}>
                <svg width="64" height="64" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
          </div>
          {/* Main Content */}
          <div style={{ flex: 1, padding: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 15,
                fontWeight: 500,
                background: '#e3f2fd',
                color: '#2563eb',
                marginLeft: 0
              }}>
                {mediaItem.MediaType}
              </span>
              {mediaItem.Genre && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: 15,
                  fontWeight: 500,
                  background: '#f5f5f5',
                  color: '#666',
                  marginLeft: 0
                }}>
                  {mediaItem.Genre}
                </span>
              )}
            </div>
            {/* Release Date and Tags */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 8 }}>
              {mediaItem.ReleaseDate && (
                <div style={{ color: '#374151', fontSize: 16 }}>
                  <strong>Release:</strong> {formatDate(mediaItem.ReleaseDate)}
                </div>
              )}
              {mediaItem.Tags && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {mediaItem.Tags.split(',').map((tag: string, index: number) => (
                    <span
                      key={index}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '4px 10px',
                        borderRadius: 6,
                        fontSize: 14,
                        background: '#e9ecef',
                        color: '#495057',
                        fontWeight: 500
                      }}
                    >
                      #{tag.trim()}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* Description */}
            {mediaItem.Description && (
              <div style={{ margin: '12px 0 0 0' }}>
                <div style={{ fontSize: 16, color: '#374151', lineHeight: 1.6 }}>{mediaItem.Description}</div>
              </div>
            )}
            {/* External Links */}
            {Object.keys(externalLinks).length > 0 && (
              <div style={{ margin: '16px 0 0 0' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#333', marginBottom: 8 }}>External Links</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {Object.entries(externalLinks).map(([key, url]) => (
                    <a
                      key={key}
                      href={url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        color: '#2563eb',
                        textDecoration: 'none',
                        fontSize: 15,
                        gap: 8,
                        background: '#f3f4f6',
                        borderRadius: 6,
                        padding: '6px 12px',
                        fontWeight: 500,
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = '#e0e7ef';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = '#f3f4f6';
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
            <div style={{ borderTop: '1px solid #e9ecef', marginTop: 24, paddingTop: 16, fontSize: 14, color: '#6c757d', display: 'flex', gap: 24 }}>
              <div>Created: {formatDate(mediaItem.CreationDate)}</div>
              <div>ID: {mediaItem.Id}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
