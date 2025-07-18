import { useState, useEffect } from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { Link, useNavigate } from 'react-router-dom';
import { MediaLibraryService, type MediaItem } from '../services/mediaLibraryService';
import { PageHeader } from '../components/PageHeader';
import { siteConfig } from '../configuration';
import { loadBackgroundImage } from '../services/sensenet';

const MEDIA_TYPES = ['Film', 'TV Series', 'TV Episode', 'Book', 'Comic', 'Video Game', 'Podcast', 'Other'];
const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'Other'];

export default function MediaLibraryPage() {
  const { oidcUser } = useOidcAuthentication();
  const navigate = useNavigate();
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);

  // Load background image (same as timeline/media item pages)
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

  useEffect(() => {
    loadMediaItems();
  }, []);

  const loadMediaItems = async () => {
    try {
      setLoading(true);
      setError('');
      const items = await MediaLibraryService.getMediaItems();
      setMediaItems(items);
    } catch (err) {
      console.error('Error loading media items:', err);
      setError('Failed to load media items. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    // In a real app, this would filter server-side
    loadMediaItems();
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedType('');
    setSelectedGenre('');
    loadMediaItems();
  };

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
      return JSON.parse(externalLinksJson);
    } catch {
      return { url: externalLinksJson };
    }
  };


  if (loading && mediaItems.length === 0) {
    return (
      <>
        <PageHeader
          title="Media Library"
          subtitle="Browse and manage your global media collection."
          backgroundImage={backgroundImageUrl || undefined}
          overlayOpacity={siteConfig.headerOverlayOpacity}
        />
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ marginBottom: 16, fontSize: 16, color: '#666' }}>Loading media library...</div>
        </div>
      </>
    );
  }


  return (
    <>
      <PageHeader
        title="Media Library"
        subtitle="Browse and manage your global media collection."
        backgroundImage={backgroundImageUrl || undefined}
        overlayOpacity={siteConfig.headerOverlayOpacity}
      >
        {oidcUser && (
          <>
            <Link
              to="/media-library/create"
              style={{
                background: '#2a4d8f',
                color: 'white',
                textDecoration: 'none',
                padding: '12px 24px',
                borderRadius: 6,
                fontWeight: 500,
                display: 'inline-block',
                boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
                marginTop: 8
              }}
            >
              Add Media Item
            </Link>
            <span style={{ color: '#fff', marginLeft: 16, fontWeight: 400 }}>
              or <Link to="/media-library/create" style={{ color: '#fff', fontWeight: 500, textDecoration: 'underline' }}>add a new item</Link>.
            </span>
          </>
        )}
      </PageHeader>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>

      {/* Search and Filters */}
      <div style={{
        background: '#fff',
        border: '1px solid #e9ecef',
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #ced4da',
                borderRadius: 6,
                fontSize: 14,
                outline: 'none'
              }}
              placeholder="Search titles, descriptions..."
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>Media Type</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #ced4da',
                borderRadius: 6,
                fontSize: 14,
                outline: 'none'
              }}
            >
              <option value="">All Types</option>
              {MEDIA_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>Genre</label>
            <select
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #ced4da',
                borderRadius: 6,
                fontSize: 14,
                outline: 'none'
              }}
            >
              <option value="">All Genres</option>
              {GENRES.map(genre => (
                <option key={genre} value={genre}>{genre}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
            <button
              onClick={handleSearch}
              disabled={loading}
              style={{
                background: loading ? '#94a3b8' : '#2a4d8f',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              Search
            </button>
            <button
              onClick={clearFilters}
              disabled={loading}
              style={{
                background: loading ? '#f1f5f9' : '#f8f9fa',
                color: loading ? '#94a3b8' : '#495057',
                border: '1px solid #e9ecef',
                borderRadius: 6,
                padding: '8px 16px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 6,
          padding: 16,
          marginBottom: 24,
          color: '#dc2626'
        }}>
          {error}
        </div>
      )}

      {/* Media Items Grid */}
      {mediaItems.length === 0 && !loading ? (
        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: 12,
          padding: 40,
          textAlign: 'center'
        }}>
          <h3 style={{ marginBottom: 16, color: '#495057', fontSize: 18, fontWeight: 600 }}>No media items found</h3>
          <p style={{ color: '#6c757d', marginBottom: 24 }}>
            {searchQuery || selectedType || selectedGenre 
              ? 'Try adjusting your search criteria.' 
              : 'Get started by adding your first media item.'}
          </p>
          {oidcUser && (
            <Link 
              to="/media-library/create"
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
              Add Media Item
            </Link>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {mediaItems.map((item) => {
            const externalLinks = getExternalLinks(item.ExternalLinks);
            return (
              <div key={item.Id} style={{
                background: '#fff',
                border: '1px solid #e9ecef',
                borderRadius: 12,
                padding: 20,
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                transition: 'transform 0.2s, box-shadow 0.2s',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'flex-start',
                minHeight: 180,
                gap: 20,
              }}
                onClick={() => navigate(`/media-library/${item.Name}`)}
              >
                {/* Cover image left-aligned */}
                {item.CoverImageUrl && (
                  <img
                    src={item.CoverImageUrl}
                    alt={item.DisplayName + ' cover'}
                    style={{
                      width: 90,
                      height: 120,
                      objectFit: 'cover',
                      borderRadius: 8,
                      boxShadow: '0 2px 8px rgba(42,77,143,0.10)',
                      flexShrink: 0,
                    }}
                    onError={e => (e.currentTarget.style.display = 'none')}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <h3 style={{
                    marginBottom: 4,
                    color: '#2a4d8f',
                    fontSize: 18,
                    fontWeight: 600,
                    textAlign: 'left',
                    marginTop: 0,
                  }}>
                    {item.DisplayName}
                  </h3>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <span style={{
                      background: '#e3f2fd',
                      color: '#1976d2',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 500
                    }}>
                      {item.MediaType}
                    </span>
                    {item.Genre && (
                      <span style={{
                        background: '#f3e5f5',
                        color: '#7b1fa2',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500
                      }}>
                        {item.Genre}
                      </span>
                    )}
                  </div>
                  {/* Description omitted for cleaner card UI */}
                  {/* External Links */}
                  {Object.keys(externalLinks).length > 0 && (
                    <div style={{ marginBottom: 12, width: '100%' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Object.entries(externalLinks).slice(0, 2).map(([key, url]) => (
                          <a
                            key={key}
                            href={url as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              color: '#2a4d8f',
                              fontSize: 12,
                              textDecoration: 'none',
                              background: '#f8f9fa',
                              padding: '2px 6px',
                              borderRadius: 3,
                              border: '1px solid #e9ecef'
                            }}
                          >
                            {key === 'url' ? 'Link' : key}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#999', marginTop: 'auto', width: '100%', textAlign: 'left' }}>
                    Added {formatDate(item.CreationDate)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </>
  );
}
