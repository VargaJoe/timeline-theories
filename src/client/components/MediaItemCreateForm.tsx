// src/client/components/MediaItemCreateForm.tsx
import React, { useState } from 'react';
import { MediaLibraryService, type CreateMediaItemRequest, type MediaItem } from '../services/mediaLibraryService';

interface MediaItemCreateFormProps {
  onSuccess?: (mediaItem: MediaItem) => void;
  onCancel?: () => void;
}

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

export const MediaItemCreateForm: React.FC<MediaItemCreateFormProps> = ({ 
  onSuccess, 
  onCancel 
}) => {
  const [formData, setFormData] = useState<CreateMediaItemRequest>({
    DisplayName: '',
    Description: '',
    MediaType: 'Movie',
    ReleaseDate: '',
    ChronologicalDate: '',
    CoverImageUrl: '',
    Duration: undefined,
    Genre: 'Action',
    Rating: undefined,
    ExternalLinks: '',
    Tags: ''
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    
    if (!formData.DisplayName?.trim()) {
      errors.DisplayName = 'Title is required';
    }
    
    if (!formData.Description?.trim()) {
      errors.Description = 'Description is required';
    }

    if (formData.Rating && (formData.Rating < 1 || formData.Rating > 10)) {
      errors.Rating = 'Rating must be between 1 and 10';
    }

    if (formData.Duration && formData.Duration < 1) {
      errors.Duration = 'Duration must be positive';
    }

    if (formData.CoverImageUrl && !isValidUrl(formData.CoverImageUrl)) {
      errors.CoverImageUrl = 'Please enter a valid URL';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleInputChange = (field: keyof CreateMediaItemRequest, value: string | number | undefined) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear validation error when user starts typing
    if (validationErrors[field]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Prepare external links as JSON if provided
      let externalLinksJson = '';
      if (formData.ExternalLinks?.trim()) {
        try {
          // Try to parse as JSON first
          JSON.parse(formData.ExternalLinks);
          externalLinksJson = formData.ExternalLinks;
        } catch {
          // If not JSON, treat as simple URL and create JSON structure
          externalLinksJson = JSON.stringify({ url: formData.ExternalLinks.trim() });
        }
      }

      const mediaItemData: CreateMediaItemRequest = {
        ...formData,
        ExternalLinks: externalLinksJson,
        Duration: formData.Duration ? Number(formData.Duration) : undefined,
        Rating: formData.Rating ? Number(formData.Rating) : undefined
      };

      const newMediaItem = await MediaLibraryService.createMediaItem(mediaItemData);
      
      setSuccess(true);
      setTimeout(() => {
        if (onSuccess) {
          onSuccess(newMediaItem);
        }
      }, 1500);
      
    } catch (err) {
      console.error('Error creating media item:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
        <div className="text-center">
          <div className="mb-4">
            <svg className="mx-auto h-12 w-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Media Item Created!</h2>
          <p className="text-gray-600">Your media item has been added to the global library successfully.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Add Media Item to Library</h2>
      
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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
            Title *
          </label>
          <input
            type="text"
            id="title"
            value={formData.DisplayName}
            onChange={(e) => handleInputChange('DisplayName', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              validationErrors.DisplayName ? 'border-red-300' : 'border-gray-300'
            }`}
            placeholder="e.g., The Empire Strikes Back"
          />
          {validationErrors.DisplayName && (
            <p className="mt-1 text-sm text-red-600">{validationErrors.DisplayName}</p>
          )}
        </div>

        {/* Media Type and Genre */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="mediaType" className="block text-sm font-medium text-gray-700 mb-2">
              Media Type *
            </label>
            <select
              id="mediaType"
              value={formData.MediaType}
              onChange={(e) => handleInputChange('MediaType', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {MEDIA_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="genre" className="block text-sm font-medium text-gray-700 mb-2">
              Genre
            </label>
            <select
              id="genre"
              value={formData.Genre || ''}
              onChange={(e) => handleInputChange('Genre', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Select genre...</option>
              {GENRES.map(genre => (
                <option key={genre} value={genre}>{genre}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
            Description *
          </label>
          <textarea
            id="description"
            rows={4}
            value={formData.Description}
            onChange={(e) => handleInputChange('Description', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              validationErrors.Description ? 'border-red-300' : 'border-gray-300'
            }`}
            placeholder="Brief description or synopsis..."
          />
          {validationErrors.Description && (
            <p className="mt-1 text-sm text-red-600">{validationErrors.Description}</p>
          )}
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="releaseDate" className="block text-sm font-medium text-gray-700 mb-2">
              Release Date
            </label>
            <input
              type="date"
              id="releaseDate"
              value={formData.ReleaseDate || ''}
              onChange={(e) => handleInputChange('ReleaseDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label htmlFor="chronologicalDate" className="block text-sm font-medium text-gray-700 mb-2">
              In-Universe Date
            </label>
            <input
              type="text"
              id="chronologicalDate"
              value={formData.ChronologicalDate || ''}
              onChange={(e) => handleInputChange('ChronologicalDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., 3 ABY, 2012, Season 3"
            />
          </div>
        </div>

        {/* Duration and Rating */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="duration" className="block text-sm font-medium text-gray-700 mb-2">
              Duration (minutes)
            </label>
            <input
              type="number"
              id="duration"
              value={formData.Duration || ''}
              onChange={(e) => handleInputChange('Duration', e.target.value ? Number(e.target.value) : undefined)}
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                validationErrors.Duration ? 'border-red-300' : 'border-gray-300'
              }`}
              min="1"
              placeholder="e.g., 124"
            />
            {validationErrors.Duration && (
              <p className="mt-1 text-sm text-red-600">{validationErrors.Duration}</p>
            )}
          </div>

          <div>
            <label htmlFor="rating" className="block text-sm font-medium text-gray-700 mb-2">
              Rating (1-10)
            </label>
            <input
              type="number"
              id="rating"
              value={formData.Rating || ''}
              onChange={(e) => handleInputChange('Rating', e.target.value ? Number(e.target.value) : undefined)}
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                validationErrors.Rating ? 'border-red-300' : 'border-gray-300'
              }`}
              min="1"
              max="10"
              step="0.1"
              placeholder="e.g., 8.5"
            />
            {validationErrors.Rating && (
              <p className="mt-1 text-sm text-red-600">{validationErrors.Rating}</p>
            )}
          </div>
        </div>

        {/* Cover Image URL */}
        <div>
          <label htmlFor="coverImage" className="block text-sm font-medium text-gray-700 mb-2">
            Cover Image URL
          </label>
          <input
            type="url"
            id="coverImage"
            value={formData.CoverImageUrl || ''}
            onChange={(e) => handleInputChange('CoverImageUrl', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
              validationErrors.CoverImageUrl ? 'border-red-300' : 'border-gray-300'
            }`}
            placeholder="https://example.com/poster.jpg"
          />
          {validationErrors.CoverImageUrl && (
            <p className="mt-1 text-sm text-red-600">{validationErrors.CoverImageUrl}</p>
          )}
        </div>

        {/* External Links */}
        <div>
          <label htmlFor="externalLinks" className="block text-sm font-medium text-gray-700 mb-2">
            External Links
          </label>
          <textarea
            id="externalLinks"
            rows={3}
            value={formData.ExternalLinks || ''}
            onChange={(e) => handleInputChange('ExternalLinks', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder='JSON format: {"imdb": "https://...", "wiki": "https://..."} or simple URL'
          />
          <p className="mt-1 text-sm text-gray-500">
            Enter a single URL or JSON object with multiple links
          </p>
        </div>

        {/* Tags */}
        <div>
          <label htmlFor="tags" className="block text-sm font-medium text-gray-700 mb-2">
            Tags
          </label>
          <input
            type="text"
            id="tags"
            value={formData.Tags || ''}
            onChange={(e) => handleInputChange('Tags', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="star-wars, original-trilogy, luke-skywalker"
          />
          <p className="mt-1 text-sm text-gray-500">
            Comma-separated tags for better organization
          </p>
        </div>

        {/* Buttons */}
        <div className="flex justify-end space-x-4 pt-6">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-6 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors"
              disabled={isSubmitting}
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating...
              </span>
            ) : (
              'Add to Library'
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default MediaItemCreateForm;
