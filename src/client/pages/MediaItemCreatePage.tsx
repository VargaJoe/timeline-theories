// src/client/pages/MediaItemCreatePage.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import MediaItemCreateForm from '../components/MediaItemCreateForm';
import type { MediaItem } from '../services/mediaLibraryService';

const MediaItemCreatePage: React.FC = () => {
  const navigate = useNavigate();

  const handleSuccess = (_mediaItem: MediaItem) => {
    // Navigate to media library or media item detail page
    navigate('/media-library');
  };

  const handleCancel = () => {
    navigate('/media-library');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Add Media Item</h1>
          <p className="mt-2 text-gray-600">
            Add a new movie, TV show, book, or other media item to the global library.
            Once added, you can use it in multiple timelines.
          </p>
        </div>

        <MediaItemCreateForm 
          onSuccess={handleSuccess}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
};

export default MediaItemCreatePage;
