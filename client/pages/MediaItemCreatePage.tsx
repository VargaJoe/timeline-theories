// src/client/pages/MediaItemCreatePage.tsx
import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
    <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
      <div style={{ marginBottom: 32 }}>
        <Link 
          to="/media-library" 
          style={{ 
            color: '#2a4d8f', 
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 16,
            display: 'inline-block'
          }}
        >
          ← Back to Media Library
        </Link>
        <h1 style={{ marginBottom: 8, color: '#2a4d8f', fontSize: 28, fontWeight: 700 }}>Add Media Item</h1>
        <p style={{ color: '#666', margin: 0 }}>
          Add a new movie, TV show, book, or other media item to the global library.
          Once added, you can use it in multiple timelines.
        </p>
      </div>

      <MediaItemCreateForm 
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  );
};

export default MediaItemCreatePage;
