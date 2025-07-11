import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { MediaItem } from '../services/mediaLibraryService';
import { MediaLibraryService } from '../services/mediaLibraryService';

export const MediaItemViewPage: React.FC = () => {
  const { id } = useParams();
  const [mediaItem, setMediaItem] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    
    const loadMediaItem = async () => {
      try {
        setLoading(true);
        const item = await MediaLibraryService.getMediaItem(Number(id));
        setMediaItem(item);
      } catch (err) {
        console.error('Failed to load media item:', err);
        setError('Failed to load media item');
      } finally {
        setLoading(false);
      }
    };

    loadMediaItem();
  }, [id]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-blue-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-gray-600">Loading media item...</p>
        </div>
      </div>
    );
  }

  if (error || !mediaItem) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Media Item Not Found</h1>
          <p className="text-gray-600 mb-4">{error || 'The media item you are looking for does not exist.'}</p>
          <Link 
            to="/media-library" 
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            ← Back to Media Library
          </Link>
        </div>
      </div>
    );
  }

  const externalLinks = getExternalLinks(mediaItem.ExternalLinks);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <Link 
            to="/media-library" 
            className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-4"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Media Library
          </Link>
          
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">{mediaItem.DisplayName}</h1>
            
            {/* Media Type Badge */}
            <div className="mb-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                {mediaItem.MediaType}
              </span>
              {mediaItem.Genre && (
                <span className="ml-2 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800">
                  {mediaItem.Genre}
                </span>
              )}
            </div>

            {/* Description */}
            {mediaItem.Description && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Description</h2>
                <p className="text-gray-700 leading-relaxed">{mediaItem.Description}</p>
              </div>
            )}

            {/* Tags */}
            {mediaItem.Tags && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Tags</h2>
                <div className="flex flex-wrap gap-2">
                  {mediaItem.Tags.split(',').map((tag: string, index: number) => (
                    <span 
                      key={index}
                      className="inline-flex items-center px-2 py-1 rounded text-sm bg-gray-200 text-gray-800"
                    >
                      #{tag.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* External Links */}
            {Object.keys(externalLinks).length > 0 && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">External Links</h2>
                <div className="space-y-2">
                  {Object.entries(externalLinks).map(([key, url]) => (
                    <a
                      key={key}
                      href={url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-blue-600 hover:text-blue-800"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      {key === 'url' ? 'External Link' : key.charAt(0).toUpperCase() + key.slice(1)}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="border-t pt-6 text-sm text-gray-500">
              <p>Created: {formatDate(mediaItem.CreationDate)}</p>
              <p>ID: {mediaItem.Id}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
