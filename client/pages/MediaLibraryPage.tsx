import { useState, useEffect, useCallback } from 'react';
import { useSharedAuth } from '../context/useSharedAuth';
import { Link, useNavigate } from 'react-router-dom';
import { MediaLibraryService, type MediaItem } from '../services/mediaLibraryService';
import { PageHeader } from '../components/PageHeader';
import { LazyImage } from '../components/LazyImage';
import { BookImportDialog } from '../components/BookImportDialog';
import { MediaItemEditDialog } from '../components/MediaItemEditDialog';
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

function isAdmin(user: any): boolean {
  if (!user) return false;
  
  // Special case: Admin user is always admin
  if (user.Name === 'Admin' || user.LoginName === 'Admin') {
    return true;
  }
  
  // Check SenseNet group membership first
  if (user.Groups && Array.isArray(user.Groups)) {
    // Check if user is member of 'administrators' group
    const isInAdminGroup = user.Groups.some((group: any) => {
      // Group can be an object with Name property or just a string
      const groupName = typeof group === 'string' ? group : group?.Name || group?.DisplayName;
      return groupName === 'administrators' || groupName === 'Administrators';
    });
    if (isInAdminGroup) return true;
  }
  
  // Fallback to email-based admin check
  const userEmail = user.email || user.Email || user.preferred_username || user.name;
  return siteConfig.adminEmails.length === 0 || siteConfig.adminEmails.includes(userEmail);
}

export default function MediaLibraryPage() {
  // Use unified auth context
  const { user } = useSharedAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);

  // ABC pagination state
  const [characterFilter, setCharacterFilter] = useState<string>('a');
  const [loadedMediaItems, setLoadedMediaItems] = useState<MediaItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearchQuery, setAppliedSearchQuery] = useState('');

  // Edit dialog state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<MediaItem | null>(null);
  const [showBookImportDialog, setShowBookImportDialog] = useState(false);

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

  const loadMediaItems = useCallback(async (reset: boolean = false, customSkip?: number) => {
    try {
      if (reset) {
        setLoading(true);
      }
      setError('');
      
      const skip = customSkip !== undefined ? customSkip : (reset ? 0 : loadedMediaItems.length);
      const items = await MediaLibraryService.getMediaItems(
        characterFilter, 
        appliedSearchQuery, 
        skip, 
        siteConfig.timelineList.allViewPageSize
      );
      
      if (reset) {
        setLoadedMediaItems(items);
      } else {
        setLoadedMediaItems(prev => [...prev, ...items]);
      }
      setHasMore(items.length === siteConfig.timelineList.allViewPageSize);
    } catch (err) {
      console.error('Error loading media items:', err);
      setError('Failed to load media items. Please check your connection and try again.');
    } finally {
      if (reset) {
        setLoading(false);
      }
    }
  }, [characterFilter, appliedSearchQuery, siteConfig.timelineList.allViewPageSize]);

  useEffect(() => {
    loadMediaItems(true);
  }, [loadMediaItems]);

  const loadMoreMediaItems = async () => {
    if (loadingMore || !hasMore) return;
    
    setLoadingMore(true);
    try {
      await loadMediaItems(false, loadedMediaItems.length);
    } catch (error) {
      console.error('Failed to load more media items:', error);
      setError('Failed to load more media items');
    } finally {
      setLoadingMore(false);
    }
  };

  const handleCharacterFilterChange = (character: string) => {
    setCharacterFilter(character);
    setAppliedSearchQuery(''); // Clear search when changing character filter
    setSearchQuery('');
    setLoadedMediaItems([]);
    setHasMore(false);
    setLoadingMore(false);
    loadMediaItems(true);
  };

  const handleSearch = () => {
    setAppliedSearchQuery(searchQuery);
    setCharacterFilter(''); // Clear character filter when searching
    setLoadedMediaItems([]);
    setHasMore(false);
    setLoadingMore(false);
    loadMediaItems(true);
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleEditItem = (item: MediaItem, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigation to item detail page
    setEditingItem(item);
    setShowEditDialog(true);
  };

  const handleEditSave = (updatedItem: MediaItem) => {
    // Update the item in the local state
    setLoadedMediaItems(prev => prev.map(item => 
      item.Id === updatedItem.Id ? updatedItem : item
    ));
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


  if (loading && loadedMediaItems.length === 0) {
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
        {user && isAdmin(user) && (
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
            <button
              onClick={() => setShowBookImportDialog(true)}
              style={{
                background: '#28a745',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: 6,
                fontWeight: 500,
                display: 'inline-block',
                boxShadow: '0 2px 4px rgba(0,0,0,0.08)',
                marginTop: 8,
                marginLeft: 12,
                cursor: 'pointer'
              }}
            >
              Import Books
            </button>
            <span style={{ color: '#fff', marginLeft: 16, fontWeight: 400 }}>
              or <Link to="/media-library/create" style={{ color: '#fff', fontWeight: 500, textDecoration: 'underline' }}>add a new item</Link>.
            </span>
          </>
        )}
      </PageHeader>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>

      {/* Search and ABC Navigation */}
      <div style={{
        background: '#fff',
        border: '1px solid #e9ecef',
        borderRadius: 12,
        padding: 24,
        marginBottom: 24,
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
          {/* ABC Navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500, color: '#495057', marginRight: 8 }}>Browse:</span>
            {['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'].map(char => (
              <button
                key={char}
                onClick={() => handleCharacterFilterChange(char.toLowerCase())}
                style={{
                  background: characterFilter === char.toLowerCase() ? '#2a4d8f' : '#f8f9fa',
                  color: characterFilter === char.toLowerCase() ? '#fff' : '#495057',
                  border: characterFilter === char.toLowerCase() ? '1px solid #2a4d8f' : '1px solid #e9ecef',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  minWidth: 32,
                  textAlign: 'center'
                }}
              >
                {char}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: '#495057', marginBottom: 8 }}>Search</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleSearchKeyPress}
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
          <div style={{ display: 'flex', alignItems: 'end', gap: 8 }}>
            <button
              onClick={handleSearch}
              disabled={loading}
              style={{
                background: loading ? '#f1f5f9' : '#2a4d8f',
                color: loading ? '#94a3b8' : '#fff',
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
            {(appliedSearchQuery || characterFilter) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setAppliedSearchQuery('');
                  setCharacterFilter('a');
                  setLoadedMediaItems([]);
                  setHasMore(false);
                  setLoadingMore(false);
                }}
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
            )}
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
      {loadedMediaItems.length === 0 && !loading ? (
        <div style={{
          background: '#f8f9fa',
          border: '1px solid #e9ecef',
          borderRadius: 12,
          padding: 40,
          textAlign: 'center'
        }}>
          <h3 style={{ marginBottom: 16, color: '#495057', fontSize: 18, fontWeight: 600 }}>No media items found</h3>
          <p style={{ color: '#6c757d', marginBottom: 24 }}>
            {appliedSearchQuery || characterFilter !== 'a'
              ? 'Try adjusting your search criteria.' 
              : 'Get started by adding your first media item.'}
          </p>
          {user && isAdmin(user) && (
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
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 20 }}>
            {loadedMediaItems.map((item) => {
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
                        {item.Title || item.DisplayName}
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
                    {item.Year && (
                      <div style={{ fontSize: 14, color: '#666', marginBottom: 8, textAlign: 'center' }}>
                        {item.Year}
                      </div>
                    )}
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
                    {/* Edit Button for authenticated users */}
                    {user && isAdmin(user) && (
                      <div style={{ marginBottom: 8, width: '100%', display: 'flex', justifyContent: 'center' }}>
                        <button
                          onClick={(e) => handleEditItem(item, e)}
                          style={{
                            background: '#28a745',
                            color: 'white',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                            transition: 'background-color 0.2s'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.background = '#218838'}
                          onMouseOut={(e) => e.currentTarget.style.background = '#28a745'}
                        >
                          Edit
                        </button>
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

          {/* Load More Button */}
          {hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
              <button
                onClick={loadMoreMediaItems}
                disabled={loadingMore}
                style={{
                  background: loadingMore ? '#f1f5f9' : '#2a4d8f',
                  color: loadingMore ? '#94a3b8' : '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '12px 24px',
                  cursor: loadingMore ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                {loadingMore ? (
                  <>
                    <div style={{ width: 16, height: 16, border: '2px solid #94a3b8', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                    Loading...
                  </>
                ) : (
                  'Load More'
                )}
              </button>
            </div>
          )}
        </>
      )}
      </div>

      <BookImportDialog
        isOpen={showBookImportDialog}
        onClose={() => setShowBookImportDialog(false)}
        onImportComplete={() => {
          setShowBookImportDialog(false);
          // Refresh the media library
          loadMediaItems(true);
        }}
      />
      <MediaItemEditDialog
        isOpen={showEditDialog}
        onClose={() => setShowEditDialog(false)}
        mediaItem={editingItem}
        onSave={handleEditSave}
      />
    </>
  );
}
