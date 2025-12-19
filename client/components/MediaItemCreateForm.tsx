// src/client/components/MediaItemCreateForm.tsx
import React, { useState, useEffect } from 'react';
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

// Series metadata inheritance utilities
const saveSeriesMetadata = (publisher: string, author?: string) => {
  if (publisher.trim()) {
    const seriesData = { publisher: publisher.trim(), author: author?.trim() || '', timestamp: Date.now() };
    localStorage.setItem('timeline-theories-series-metadata', JSON.stringify(seriesData));
  }
};

const loadSeriesMetadata = () => {
  try {
    const data = localStorage.getItem('timeline-theories-series-metadata');
    if (data) {
      const parsed = JSON.parse(data);
      // Only use data from last 30 days
      if (Date.now() - parsed.timestamp < 30 * 24 * 60 * 60 * 1000) {
        return parsed;
      } else {
        localStorage.removeItem('timeline-theories-series-metadata');
      }
    }
  } catch (e) {
    console.warn('Failed to load series metadata:', e);
  }
  return null;
};

// Inline styles for consistency
const containerStyle = {
  background: '#fff',
  border: '1px solid #e9ecef',
  borderRadius: 12,
  padding: 24,
  boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
};

const labelStyle = {
  display: 'block',
  fontSize: 14,
  fontWeight: 500,
  color: '#495057',
  marginBottom: 8
};

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #ced4da',
  borderRadius: 6,
  fontSize: 14,
  outline: 'none'
};

const errorInputStyle = {
  ...inputStyle,
  border: '1px solid #dc3545'
};

const textareaStyle = {
  ...inputStyle,
  minHeight: 80,
  resize: 'vertical' as const
};

const errorStyle = {
  color: '#dc3545',
  fontSize: 12,
  marginTop: 4
};

const buttonPrimaryStyle = {
  background: '#2a4d8f',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  padding: '10px 20px',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
  marginRight: 12
};

const buttonSecondaryStyle = {
  background: '#f8f9fa',
  color: '#495057',
  border: '1px solid #e9ecef',
  borderRadius: 6,
  padding: '10px 20px',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500
};

const buttonDisabledStyle = {
  ...buttonPrimaryStyle,
  background: '#94a3b8',
  cursor: 'not-allowed'
};

export const MediaItemCreateForm: React.FC<MediaItemCreateFormProps> = ({ 
  onSuccess, 
  onCancel 
}) => {
  const [formData, setFormData] = useState<CreateMediaItemRequest>({
    DisplayName: '',
    Description: '',
    MediaType: 'Movie',
    ReleaseDate: '',
    Year: undefined,
    ChronologicalDate: '',
    CoverImageUrl: '',
    Duration: undefined,
    Genre: 'Action',
    Rating: undefined,
    ExternalLinks: '',
    Tags: '',
    // Book-specific fields
    Author: '',
    Publisher: '',
    ISBN: '',
    PublicationYear: undefined,
    BookSeriesNumber: undefined,
    SeriesName: ''
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
      setValidationErrors(prev => ({ ...prev, [field]: '' }));
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
      const mediaItem = await MediaLibraryService.createMediaItem(formData);
      setSuccess(true);
      
      // Save series metadata for future book creation
      if (formData.MediaType === 'Book' && formData.Publisher) {
        saveSeriesMetadata(formData.Publisher, formData.Author);
      }
      
      // Call success callback after a short delay to show success message
      setTimeout(() => {
        onSuccess?.(mediaItem);
      }, 1500);
    } catch (err) {
      console.error('Error creating media item:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Load series metadata from localStorage on component mount
  useEffect(() => {
    const metadata = loadSeriesMetadata();
    if (metadata) {
      setFormData(prev => ({
        ...prev,
        Publisher: metadata.publisher,
        Author: metadata.author
      }));
    }
  }, []);

  // Load series metadata when MediaType changes to Book
  useEffect(() => {
    if (formData.MediaType === 'Book' && !formData.Publisher && !formData.Author) {
      const seriesData = loadSeriesMetadata();
      if (seriesData) {
        setFormData(prev => ({
          ...prev,
          Publisher: seriesData.publisher || prev.Publisher,
          Author: seriesData.author || prev.Author
        }));
      }
    }
  }, [formData.MediaType, formData.Publisher, formData.Author]);

  if (success) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 16 }}>
            <svg 
              style={{ 
                width: 48, 
                height: 48, 
                color: '#28a745', 
                margin: '0 auto',
                display: 'block'
              }} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#495057', marginBottom: 8 }}>Media Item Created!</h2>
          <p style={{ color: '#6c757d' }}>Your media item has been added to the global library successfully.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#495057', marginBottom: 24 }}>Add Media Item to Library</h2>
      
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

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gap: 20 }}>
          {/* Title */}
          <div>
            <label style={labelStyle}>Title *</label>
            <input
              type="text"
              value={formData.DisplayName}
              onChange={(e) => handleInputChange('DisplayName', e.target.value)}
              style={validationErrors.DisplayName ? errorInputStyle : inputStyle}
              placeholder="Enter the title of your media item"
            />
            {validationErrors.DisplayName && (
              <div style={errorStyle}>{validationErrors.DisplayName}</div>
            )}
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description *</label>
            <textarea
              value={formData.Description}
              onChange={(e) => handleInputChange('Description', e.target.value)}
              style={validationErrors.Description ? { ...textareaStyle, border: '1px solid #dc3545' } : textareaStyle}
              placeholder="Describe your media item..."
            />
            {validationErrors.Description && (
              <div style={errorStyle}>{validationErrors.Description}</div>
            )}
          </div>

          {/* Media Type and Genre */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Media Type *</label>
              <select
                value={formData.MediaType}
                onChange={(e) => handleInputChange('MediaType', e.target.value)}
                style={inputStyle}
              >
                {MEDIA_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Genre</label>
              <select
                value={formData.Genre}
                onChange={(e) => handleInputChange('Genre', e.target.value)}
                style={inputStyle}
              >
                {GENRES.map(genre => (
                  <option key={genre} value={genre}>{genre}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Year</label>
              <input
                type="number"
                min="1800"
                max="2100"
                value={formData.Year || ''}
                onChange={(e) => handleInputChange('Year', e.target.value ? parseInt(e.target.value) : undefined)}
                style={inputStyle}
                placeholder="2023"
              />
            </div>

            <div>
              <label style={labelStyle}>Release Date</label>
              <input
                type="date"
                value={formData.ReleaseDate}
                onChange={(e) => handleInputChange('ReleaseDate', e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Chronological Date</label>
              <input
                type="date"
                value={formData.ChronologicalDate}
                onChange={(e) => handleInputChange('ChronologicalDate', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          {/* Cover Image */}
          <div>
            <label style={labelStyle}>Cover Image URL</label>
            <input
              type="url"
              value={formData.CoverImageUrl}
              onChange={(e) => handleInputChange('CoverImageUrl', e.target.value)}
              style={validationErrors.CoverImageUrl ? errorInputStyle : inputStyle}
              placeholder="https://example.com/image.jpg"
            />
            {validationErrors.CoverImageUrl && (
              <div style={errorStyle}>{validationErrors.CoverImageUrl}</div>
            )}
          </div>

          {/* Duration and Rating */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Duration (minutes)</label>
              <input
                type="number"
                value={formData.Duration || ''}
                onChange={(e) => handleInputChange('Duration', e.target.value ? Number(e.target.value) : undefined)}
                style={validationErrors.Duration ? errorInputStyle : inputStyle}
                placeholder="120"
                min="1"
              />
              {validationErrors.Duration && (
                <div style={errorStyle}>{validationErrors.Duration}</div>
              )}
            </div>

            <div>
              <label style={labelStyle}>Rating (1-10)</label>
              <input
                type="number"
                value={formData.Rating || ''}
                onChange={(e) => handleInputChange('Rating', e.target.value ? Number(e.target.value) : undefined)}
                style={validationErrors.Rating ? errorInputStyle : inputStyle}
                placeholder="8"
                min="1"
                max="10"
                step="0.1"
              />
              {validationErrors.Rating && (
                <div style={errorStyle}>{validationErrors.Rating}</div>
              )}
            </div>
          </div>

          {/* External Links */}
          <div>
            <label style={labelStyle}>External Links (JSON format)</label>
            <textarea
              value={formData.ExternalLinks}
              onChange={(e) => handleInputChange('ExternalLinks', e.target.value)}
              style={textareaStyle}
              placeholder='{"imdb": "https://imdb.com/title/...", "wiki": "https://wikipedia.org/..."}'
            />
          </div>

          {/* Tags */}
          <div>
            <label style={labelStyle}>Tags (comma-separated)</label>
            <input
              type="text"
              value={formData.Tags}
              onChange={(e) => handleInputChange('Tags', e.target.value)}
              style={inputStyle}
              placeholder="adventure, space, comedy"
            />
          </div>

          {/* Book-specific fields */}
          {formData.MediaType === 'Book' && (
            <div style={{
              background: '#f8f9fa',
              border: '1px solid #e9ecef',
              borderRadius: 8,
              padding: 20,
              marginTop: 8
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: '#495057', marginBottom: 16 }}>
                Book Details
              </h3>
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>Author</label>
                    <input
                      type="text"
                      value={formData.Author || ''}
                      onChange={(e) => handleInputChange('Author', e.target.value)}
                      style={inputStyle}
                      placeholder="Book author"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Publisher</label>
                    <input
                      type="text"
                      value={formData.Publisher || ''}
                      onChange={(e) => handleInputChange('Publisher', e.target.value)}
                      style={inputStyle}
                      placeholder="Publishing company"
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                  <div>
                    <label style={labelStyle}>ISBN</label>
                    <input
                      type="text"
                      value={formData.ISBN || ''}
                      onChange={(e) => handleInputChange('ISBN', e.target.value)}
                      style={inputStyle}
                      placeholder="ISBN number"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Publication Year</label>
                    <input
                      type="number"
                      value={formData.PublicationYear || ''}
                      onChange={(e) => handleInputChange('PublicationYear', e.target.value)}
                      style={inputStyle}
                      placeholder="2024"
                      min="1000"
                      max="2100"
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Series Number</label>
                    <input
                      type="number"
                      value={formData.BookSeriesNumber || ''}
                      onChange={(e) => handleInputChange('BookSeriesNumber', e.target.value)}
                      style={inputStyle}
                      placeholder="1"
                      min="1"
                    />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Series Name</label>
                  <input
                    type="text"
                    value={formData.SeriesName || ''}
                    onChange={(e) => handleInputChange('SeriesName', e.target.value)}
                    style={inputStyle}
                    placeholder="Series name (auto-detected if available)"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                style={buttonSecondaryStyle}
                disabled={isSubmitting}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              style={isSubmitting ? buttonDisabledStyle : buttonPrimaryStyle}
            >
              {isSubmitting ? 'Creating...' : 'Create Media Item'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default MediaItemCreateForm;
