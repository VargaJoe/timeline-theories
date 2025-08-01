import { useState, useEffect } from 'react';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { Link, useNavigate } from 'react-router-dom';
import { MediaLibraryService, type MediaItem } from '../services/mediaLibraryService';
import { PageHeader } from '../components/PageHeader';
import { LazyImage } from '../components/LazyImage';
import { siteConfig } from '../configuration';
import { loadBackgroundImage } from '../services/sensenet';

// Media types from MediaItem content type definition (see deployment/contenttypes/MediaItem.xml)
const MEDIA_TYPES = [
  { value: 'movie', label: 'Movie' },
  { value: 'tvepisode', label: 'TV Episode' },
  { value: 'tvseries', label: 'TV Series' },
  { value: 'book', label: 'Book' },
  { value: 'comic', label: 'Comic' },
  { value: 'videogame', label: 'Video Game' },
  { value: 'podcast', label: 'Podcast' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'other', label: 'Other' },
];
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

  // Filtered media items based on search and filters
  // Normalize MediaType to string for filtering and display
  function normalizeMediaType(val: unknown): string {
    if (Array.isArray(val)) return val[0] || '';
    if (typeof val === 'string') return val;
    return '';
  }

  // Normalize Genre to string for filtering
  function normalizeGenre(val: unknown): string {
    if (Array.isArray(val)) return val[0] || '';
    if (typeof val === 'string') return val;
    return '';
  }

  const getFilteredMediaItems = () => {
    return mediaItems.filter((item) => {
      // Search by title or description (case-insensitive)
      const query = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !query ||
        (item.DisplayName && item.DisplayName.toLowerCase().includes(query)) ||
        (item.Description && item.Description.toLowerCase().includes(query));
      // Filter by type (normalize both sides)
      const itemType = normalizeMediaType(item.MediaType).toLowerCase();
      const filterType = (selectedType || '').toLowerCase();
      const matchesType = !filterType || itemType === filterType;
      // Filter by genre (case-insensitive, normalize both sides)
      const itemGenre = normalizeGenre(item.Genre).toLowerCase();
      const filterGenre = (selectedGenre || '').toLowerCase();
      const matchesGenre = !filterGenre || itemGenre === filterGenre;
      return matchesQuery && matchesType && matchesGenre;
    });
  };

  const handleSearch = () => {
    // No-op: filtering is now client-side and reactive
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedType('');
    setSelectedGenre('');
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
                <option key={type.value} value={type.value}>{type.label}</option>
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
      {getFilteredMediaItems().length === 0 && !loading ? (
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 20 }}>
          {getFilteredMediaItems().map((item) => {
            const externalLinks = getExternalLinks(item.ExternalLinks);
            return (
              // MagicUI card effect placeholder (replace with real import/use)
              <div key={item.Id} style={{ position: 'relative', background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 16, overflow: 'visible', cursor: 'pointer' }} onClick={() => navigate(`/media-library/${item.Name}`)}>
                <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 8px rgba(42,77,143,0.10)', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 320, border: '1px solid #e9ecef', transition: 'box-shadow 0.2s', position: 'relative' }}>
                  {/* Cover image top, portrait aspect ratio */}
                  {MediaLibraryService.getCoverImageUrl(item) && (
                    <LazyImage
                      src={MediaLibraryService.getCoverImageUrl(item)!}
                      alt={item.DisplayName + ' cover'}
                      style={{
                        width: 120,
                        height: 180,
                        objectFit: 'cover',
                        borderTopLeftRadius: 16,
                        borderTopRightRadius: 16,
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                        boxShadow: '0 2px 8px rgba(42,77,143,0.10)',
                        background: '#f8f9fa',
                        marginBottom: 0
                      }}
                      onError={e => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                  <div style={{ padding: '16px 12px 12px 12px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                    <h3 style={{
                      marginBottom: 6,
                      color: '#2a4d8f',
                      fontSize: 16,
                      fontWeight: 700,
                      textAlign: 'center',
                      marginTop: 0,
                      wordBreak: 'break-word',
                      lineHeight: 1.2
                    }}>
                      {item.DisplayName}
                    </h3>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                      <span style={{
                        background: '#e3f2fd',
                        color: '#1976d2',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500
                      }}>
                        {(() => {
                          const mt = normalizeMediaType(item.MediaType);
                          const found = MEDIA_TYPES.find(t => t.value === mt.toLowerCase());
                          return found ? found.label : mt;
                        })()}
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
                          {normalizeGenre(item.Genre)}
                        </span>
                      )}
                    </div>
                    {/* Description, if present, below title */}
                    {item.Description && (
                      <div style={{ fontSize: 13, color: '#444', marginBottom: 8, textAlign: 'center', maxHeight: 48, overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>
                        {item.Description}
                      </div>
                    )}
                    {/* External Links */}
                    {Object.keys(externalLinks).length > 0 && (
                      <div style={{ marginBottom: 8, width: '100%' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
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
                    <div style={{ fontSize: 12, color: '#999', marginTop: 'auto', width: '100%', textAlign: 'center' }}>
                      Added {formatDate(item.CreationDate)}
                    </div>
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
