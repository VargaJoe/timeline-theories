// src/client/pages/MediaLibraryPage.tsx
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MediaLibraryService, type MediaItem } from '../services/mediaLibraryService';

const MediaLibraryPage: React.FC = () => {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const navigate = useNavigate();

  const MEDIA_TYPES = [
    'Movie',
    'TVEpisode', 
    'TVSeries',
    'Book',
    'Comic',
    'VideoGame',
    'Podcast',
    'Documentary',
    'Other'
  ];

  const GENRES = [
    'Action',
    'Adventure', 
    'Comedy',
    'Drama',
    'Fantasy',
    'Horror',
    'Mystery',
    'Romance',
    'SciFi',
    'Thriller',
    'Documentary',
    'Other'
  ];

  useEffect(() => {
    loadMediaItems();
  }, []);

  const loadMediaItems = async () => {
    try {
      setLoading(true);
      setError(null);
      const items = await MediaLibraryService.getMediaItems();
      setMediaItems(items);
    } catch (err) {
      console.error('Error loading media items:', err);
      setError(err instanceof Error ? err.message : 'Failed to load media items');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    try {
      setLoading(true);
      setError(null);
      const items = await MediaLibraryService.searchMediaItems(
        searchQuery,
        selectedType || undefined,
        selectedGenre || undefined
      );
      setMediaItems(items);
    } catch (err) {
      console.error('Error searching media items:', err);
      setError(err instanceof Error ? err.message : 'Failed to search media items');
    } finally {
      setLoading(false);
    }
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-blue-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-gray-600">Loading media library...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Media Library</h1>
              <p className="mt-2 text-gray-600">
                Browse and manage your global media collection
              </p>
            </div>
            <Link
              to="/media-library/create"
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Add Media Item
            </Link>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search titles, descriptions..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Media Type</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Types</option>
                {MEDIA_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Genre</label>
              <select
                value={selectedGenre}
                onChange={(e) => setSelectedGenre(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Genres</option>
                {GENRES.map(genre => (
                  <option key={genre} value={genre}>{genre}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end space-x-2">
              <button
                onClick={handleSearch}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
              >
                Search
              </button>
              <button
                onClick={clearFilters}
                disabled={loading}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:bg-gray-100 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="flex">
              <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <p className="ml-3 text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Media Items Grid */}
        {mediaItems.length === 0 && !loading ? (
          <div className="text-center py-12">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No media items found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {searchQuery || selectedType || selectedGenre 
                ? 'Try adjusting your search criteria.' 
                : 'Get started by adding your first media item.'}
            </p>
            <div className="mt-6">
              <Link
                to="/media-library/create"
                className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                Add Media Item
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {mediaItems.map((item) => {
              const externalLinks = getExternalLinks(item.ExternalLinks);
              
              return (
                <div
                  key={item.Id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => navigate(`/media-library/${item.Id}`)}
                >
                  {/* Cover Image */}
                  {item.CoverImageUrl && (
                    <div className="aspect-w-2 aspect-h-3 w-full">
                      <img
                        src={item.CoverImageUrl}
                        alt={item.DisplayName}
                        className="w-full h-48 object-cover rounded-t-lg"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                        }}
                      />
                    </div>
                  )}
                  
                  <div className="p-4">
                    {/* Title and Type */}
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 line-clamp-2">
                        {item.DisplayName}
                      </h3>
                      <span className="ml-2 flex-shrink-0 px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                        {item.MediaType}
                      </span>
                    </div>

                    {/* Genre and Rating */}
                    <div className="flex justify-between items-center mb-2">
                      {item.Genre && (
                        <span className="text-sm text-gray-600">{item.Genre}</span>
                      )}
                      {item.Rating && (
                        <span className="text-sm font-medium text-yellow-600">
                          ⭐ {item.Rating}/10
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-sm text-gray-600 line-clamp-3 mb-3">
                      {item.Description}
                    </p>

                    {/* Metadata */}
                    <div className="space-y-1 text-xs text-gray-500">
                      {item.ReleaseDate && (
                        <div>Released: {formatDate(item.ReleaseDate)}</div>
                      )}
                      {item.ChronologicalDate && (
                        <div>In-universe: {item.ChronologicalDate}</div>
                      )}
                      {item.Duration && (
                        <div>Duration: {item.Duration} minutes</div>
                      )}
                    </div>

                    {/* External Links */}
                    {Object.keys(externalLinks).length > 0 && (
                      <div className="mt-3 flex space-x-2">
                        {Object.entries(externalLinks).slice(0, 2).map(([key, url]) => (
                          <a
                            key={key}
                            href={url as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                          >
                            {key}
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Tags */}
                    {item.Tags && (
                      <div className="mt-2">
                        <div className="flex flex-wrap gap-1">
                          {item.Tags.split(',').slice(0, 3).map((tag, index) => (
                            <span
                              key={index}
                              className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded"
                            >
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Created info */}
                    <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
                      Added {formatDate(item.CreationDate)} by {item.CreatedBy.DisplayName}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Loading indicator for search */}
        {loading && mediaItems.length > 0 && (
          <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg p-4">
            <div className="flex items-center space-x-2">
              <svg className="animate-spin h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-sm text-gray-600">Searching...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MediaLibraryPage;
