import React, { useState, useEffect } from 'react';
import { MediaLibraryService, type MediaItem, type CreateMediaItemRequest } from '../services/mediaLibraryService';
import { BookImportService, type BookSearchResult } from '../services/bookImportService';

interface MediaItemEditDialogProps {
  isOpen: boolean;
  mediaItem: MediaItem | null;
  onClose: () => void;
  onSave: (updatedItem: MediaItem) => void;
}

interface ImportData {
  title?: string;
  description?: string;
  coverUrl?: string;
  author?: string;
  publisher?: string;
  isbn?: string;
  publicationYear?: number;
  releaseDate?: string;
}

const MEDIA_TYPES = [
  'Movie', 'TVEpisode', 'TVSeries', 'Book', 'Comic', 'VideoGame', 'Podcast', 'Documentary', 'Other'
];

const GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'SciFi', 'Thriller', 'Documentary', 'Other'
];

export const MediaItemEditDialog: React.FC<MediaItemEditDialogProps> = ({
  isOpen,
  mediaItem,
  onClose,
  onSave
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
  const [showImportSection, setShowImportSection] = useState(false);
  const [importSearchQuery, setImportSearchQuery] = useState('');
  const [importResults, setImportResults] = useState<BookSearchResult[]>([]);
  const [selectedImportData, setSelectedImportData] = useState<ImportData | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  // Load media item data when dialog opens
  useEffect(() => {
    if (isOpen && mediaItem) {
      setFormData({
        DisplayName: mediaItem.DisplayName || '',
        Title: mediaItem.Title || '',
        Subtitle: mediaItem.Subtitle || '',
        Description: mediaItem.Description || '',
        MediaType: mediaItem.MediaType || 'Movie',
        ReleaseDate: mediaItem.ReleaseDate ? mediaItem.ReleaseDate.split('T')[0] : '',
        Year: mediaItem.Year,
        ChronologicalDate: mediaItem.ChronologicalDate ? mediaItem.ChronologicalDate.split('T')[0] : '',
        CoverImageUrl: mediaItem.CoverImageUrl || '',
        Duration: mediaItem.Duration,
        Genre: mediaItem.Genre || 'Action',
        Rating: mediaItem.Rating,
        ExternalLinks: mediaItem.ExternalLinks || '',
        Tags: mediaItem.Tags || '',
        Author: mediaItem.Author || '',
        Publisher: mediaItem.Publisher || '',
        ISBN: mediaItem.ISBN || '',
        PublicationYear: mediaItem.PublicationYear,
        BookSeriesNumber: mediaItem.BookSeriesNumber,
        SeriesName: mediaItem.SeriesName || ''
      });
      setError(null);
      setSuccess(false);
      setImportSearchQuery(mediaItem.DisplayName || '');
      setSelectedImportData(null);
      setShowImportSection(false);
    }
  }, [isOpen, mediaItem]);

  const handleInputChange = (field: keyof CreateMediaItemRequest, value: string | number | undefined) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleImportSearch = async () => {
    if (!importSearchQuery.trim() || !mediaItem) return;

    setImportLoading(true);
    try {
      const results = await BookImportService.searchBooks(importSearchQuery.trim(), ['openlibrary', 'googlebooks'], 5);
      setImportResults(results);
    } catch (err) {
      console.error('Import search failed:', err);
    } finally {
      setImportLoading(false);
    }
  };

  const handleSelectImportData = (book: BookSearchResult) => {
    const importData: ImportData = {
      title: book.title,
      description: book.description,
      coverUrl: book.coverUrl,
      author: book.author,
      publisher: book.publisher,
      isbn: book.isbn,
      publicationYear: book.publicationYear,
      releaseDate: book.publicationYear ? `${book.publicationYear}-01-01` : undefined
    };
    setSelectedImportData(importData);
  };

  const handleApplyImportData = () => {
    if (!selectedImportData) return;

    // Apply selected fields to form data
    setFormData(prev => ({
      ...prev,
      ...(selectedImportData.title && { Title: selectedImportData.title }),
      ...(selectedImportData.description && { Description: selectedImportData.description }),
      ...(selectedImportData.coverUrl && { CoverImageUrl: selectedImportData.coverUrl }),
      ...(selectedImportData.author && { Author: selectedImportData.author }),
      ...(selectedImportData.publisher && { Publisher: selectedImportData.publisher }),
      ...(selectedImportData.isbn && { ISBN: selectedImportData.isbn }),
      ...(selectedImportData.publicationYear && { PublicationYear: selectedImportData.publicationYear }),
      ...(selectedImportData.releaseDate && { ReleaseDate: selectedImportData.releaseDate })
    }));

    setShowImportSection(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mediaItem) return;

    setIsSubmitting(true);
    setError(null);

    try {
      console.log('🚀 Submitting update for media item:', mediaItem.Id);
      
      // Filter out empty strings for optional fields to avoid sending them as updates
      const cleanFormData = Object.entries(formData).reduce((acc, [key, value]) => {
        if (value !== '' || ['DisplayName', 'Description', 'MediaType'].includes(key)) {
          acc[key as keyof CreateMediaItemRequest] = value;
        }
        return acc;
      }, {} as Partial<CreateMediaItemRequest>);
      
      console.log('📋 Cleaned form data being sent:', cleanFormData);
      console.log('🔍 Form data types:', Object.keys(cleanFormData).reduce((acc, key) => {
        acc[key] = typeof cleanFormData[key as keyof CreateMediaItemRequest];
        return acc;
      }, {} as Record<string, string>));

      const updatedItem = await MediaLibraryService.updateMediaItem(mediaItem.Id, cleanFormData);
      console.log('✅ Update successful:', updatedItem);

      setSuccess(true);
      setTimeout(() => {
        onSave(updatedItem);
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Error updating media item:', err);
      setError(err instanceof Error ? err.message : 'Failed to update media item');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !mediaItem) return null;

  const containerStyle = {
    background: '#fff',
    border: '1px solid #e9ecef',
    borderRadius: 12,
    padding: 24,
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    maxWidth: 600,
    width: '90%',
    maxHeight: '90vh',
    overflow: 'auto'
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

  const textareaStyle = {
    ...inputStyle,
    minHeight: 80,
    resize: 'vertical' as const
  };

  const buttonPrimaryStyle = {
    background: '#2a4d8f',
    color: 'white',
    border: 'none',
    padding: '12px 24px',
    borderRadius: 6,
    fontWeight: 500,
    cursor: 'pointer'
  };

  const buttonSecondaryStyle = {
    ...buttonPrimaryStyle,
    background: '#6c757d'
  };

  const buttonDisabledStyle = {
    ...buttonPrimaryStyle,
    background: '#94a3b8',
    cursor: 'not-allowed'
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: 20
    }}>
      <div style={containerStyle}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#495057', marginBottom: 24 }}>
          Edit Media Item
        </h2>

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

        {success && (
          <div style={{
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: 6,
            padding: 16,
            marginBottom: 24,
            color: '#0369a1'
          }}>
            Media item updated successfully!
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
                style={inputStyle}
                placeholder="Enter the title"
                required
              />
            </div>

            {/* Clean Title */}
            <div>
              <label style={labelStyle}>Clean Title</label>
              <input
                type="text"
                value={formData.Title || ''}
                onChange={(e) => handleInputChange('Title', e.target.value)}
                style={inputStyle}
                placeholder="Title without year/season info"
              />
            </div>

            {/* Year */}
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

            {/* Description */}
            <div>
              <label style={labelStyle}>Description</label>
              <textarea
                value={formData.Description}
                onChange={(e) => handleInputChange('Description', e.target.value)}
                style={textareaStyle}
                placeholder="Describe the media item..."
              />
            </div>

            {/* Media Type and Genre */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={labelStyle}>Media Type</label>
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
                        onChange={(e) => handleInputChange('PublicationYear', e.target.value ? parseInt(e.target.value) : undefined)}
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
                        onChange={(e) => handleInputChange('BookSeriesNumber', e.target.value ? parseInt(e.target.value) : undefined)}
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

            {/* Import Data Section */}
            {formData.MediaType === 'Book' && (
              <div style={{
                background: '#e3f2fd',
                border: '1px solid #bbdefb',
                borderRadius: 8,
                padding: 20,
                marginTop: 8
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#1976d2', margin: 0 }}>
                    Import Data from External Sources
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowImportSection(!showImportSection)}
                    style={{
                      background: '#1976d2',
                      color: 'white',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: 4,
                      fontSize: 14,
                      cursor: 'pointer'
                    }}
                  >
                    {showImportSection ? 'Hide' : 'Show'} Import Options
                  </button>
                </div>

                {showImportSection && (
                  <div style={{ display: 'grid', gap: 16 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={importSearchQuery}
                        onChange={(e) => setImportSearchQuery(e.target.value)}
                        style={{ ...inputStyle, flex: 1 }}
                        placeholder="Search for book data..."
                      />
                      <button
                        type="button"
                        onClick={handleImportSearch}
                        disabled={importLoading}
                        style={{
                          background: importLoading ? '#94a3b8' : '#1976d2',
                          color: 'white',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: 4,
                          cursor: importLoading ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {importLoading ? 'Searching...' : 'Search'}
                      </button>
                    </div>

                    {importResults.length > 0 && (
                      <div>
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: '#1976d2', marginBottom: 8 }}>
                          Select data to import:
                        </h4>
                        <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #bbdefb', borderRadius: 4 }}>
                          {importResults.map((book, index) => (
                            <div
                              key={index}
                              style={{
                                padding: 12,
                                borderBottom: index < importResults.length - 1 ? '1px solid #bbdefb' : 'none',
                                background: selectedImportData === BookImportService.convertToImportData(book) ? '#bbdefb' : 'white',
                                cursor: 'pointer'
                              }}
                              onClick={() => handleSelectImportData(book)}
                            >
                              <div style={{ fontWeight: 600, marginBottom: 4 }}>{book.title}</div>
                              {book.author && <div style={{ fontSize: 12, color: '#666' }}>by {book.author}</div>}
                              {book.publicationYear && <div style={{ fontSize: 12, color: '#666' }}>{book.publicationYear}</div>}
                            </div>
                          ))}
                        </div>
                        {selectedImportData && (
                          <button
                            type="button"
                            onClick={handleApplyImportData}
                            style={{
                              background: '#28a745',
                              color: 'white',
                              border: 'none',
                              padding: '8px 16px',
                              borderRadius: 4,
                              marginTop: 8,
                              cursor: 'pointer'
                            }}
                          >
                            Apply Selected Data
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, gap: 12 }}>
              <button
                type="button"
                onClick={onClose}
                style={buttonSecondaryStyle}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                style={isSubmitting ? buttonDisabledStyle : buttonPrimaryStyle}
              >
                {isSubmitting ? 'Updating...' : 'Update Media Item'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};