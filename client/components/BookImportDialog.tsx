import React, { useState } from 'react';
import { BookImportService } from '../services/bookImportService';
import type { BookSearchResult, BookImportData } from '../services/bookImportService';
import { MediaLibraryService, type MediaItem } from '../services/mediaLibraryService';

interface BookImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: (importedBooks: BookImportData[]) => void;
}

export const BookImportDialog: React.FC<BookImportDialogProps> = ({
  isOpen,
  onClose,
  onImportComplete
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const results = await BookImportService.searchBooks(searchQuery.trim(), ['openlibrary', 'googlebooks'], 20);
      setSearchResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const toggleBookSelection = (bookId: string) => {
    const newSelected = new Set(selectedBooks);
    if (newSelected.has(bookId)) {
      newSelected.delete(bookId);
    } else {
      newSelected.add(bookId);
    }
    setSelectedBooks(newSelected);
  };

  // Check for duplicate books by ISBN first, then by title + author combination
  const checkForDuplicateBook = async (bookData: BookImportData): Promise<MediaItem | null> => {
    try {
      // Get all existing media items
      const allItems = await MediaLibraryService.getMediaItems();
      const existingBooks = allItems.filter(item => item.MediaType === 'book');

      // First try to find by ISBN if available
      if (bookData.ISBN) {
        const isbnMatch = existingBooks.find(book => book.ISBN === bookData.ISBN);
        if (isbnMatch) {
          return isbnMatch;
        }
      }

      // Then try to find by title + author combination
      if (bookData.Title && bookData.Author) {
        const titleAuthorMatch = existingBooks.find(book => 
          book.Title === bookData.Title && book.Author === bookData.Author
        );
        if (titleAuthorMatch) {
          return titleAuthorMatch;
        }
      }

      return null;
    } catch (error) {
      console.warn('Error checking for duplicate book:', error);
      return null;
    }
  };

  const handleImport = async () => {
    if (selectedBooks.size === 0) return;

    setImporting(true);
    setError(null);

    try {
      const booksToImport = searchResults
        .filter(book => selectedBooks.has(`${book.source}-${book.externalId}`))
        .map(book => BookImportService.convertToImportData(book));

      const importedBooks: BookImportData[] = [];
      const skippedDuplicates: string[] = [];

      for (const bookData of booksToImport) {
        try {
          // Check for duplicates before importing
          const existingBook = await checkForDuplicateBook(bookData);
          
          if (existingBook) {
            console.log('Skipping duplicate book:', bookData.DisplayName);
            skippedDuplicates.push(bookData.DisplayName);
            continue;
          }

          await MediaLibraryService.createMediaItem(bookData);
          importedBooks.push(bookData);
        } catch (err) {
          console.error('Failed to import book:', bookData.DisplayName, err);
          // Continue with other books even if one fails
        }
      }

      // Show feedback about skipped duplicates
      if (skippedDuplicates.length > 0) {
        setError(`Imported ${importedBooks.length} books. Skipped ${skippedDuplicates.length} duplicates: ${skippedDuplicates.join(', ')}`);
      }

      if (onImportComplete) {
        onImportComplete(importedBooks);
      }

      // Reset state
      setSearchResults([]);
      setSelectedBooks(new Set());
      setSearchQuery('');
      onClose();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        maxWidth: 800,
        width: '90%',
        maxHeight: '90vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #e0e0e0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ margin: 0, color: '#2a4d8f' }}>Import Books</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              cursor: 'pointer',
              color: '#666',
              padding: 0,
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ×
          </button>
        </div>

        {/* Search Section */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e0e0e0' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <input
              type="text"
              placeholder="Search for books by title, author, or ISBN..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              style={{
                flex: 1,
                padding: '12px 16px',
                border: '1px solid #ccc',
                borderRadius: 6,
                fontSize: 16
              }}
            />
            <button
              onClick={handleSearch}
              disabled={loading || !searchQuery.trim()}
              style={{
                background: loading ? '#6c757d' : '#2a4d8f',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '12px 20px',
                fontSize: 16,
                fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Results Section */}
        <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
          {error && (
            <div style={{
              background: '#f8d7da',
              color: '#721c24',
              padding: 12,
              borderRadius: 6,
              marginBottom: 16
            }}>
              {error}
            </div>
          )}

          {searchResults.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <p style={{ margin: 0, color: '#666' }}>
                Found {searchResults.length} books. Select the ones you want to import:
              </p>
            </div>
          )}

          <div style={{ display: 'grid', gap: 12 }}>
            {searchResults.map((book) => {
              const bookId = `${book.source}-${book.externalId}`;
              const isSelected = selectedBooks.has(bookId);

              return (
                <div
                  key={bookId}
                  style={{
                    border: `2px solid ${isSelected ? '#2a4d8f' : '#e0e0e0'}`,
                    borderRadius: 8,
                    padding: 16,
                    cursor: 'pointer',
                    background: isSelected ? '#f0f4ff' : '#fff',
                    display: 'flex',
                    gap: 16,
                    alignItems: 'flex-start'
                  }}
                  onClick={() => toggleBookSelection(bookId)}
                >
                  {/* Cover Image */}
                  <div style={{
                    width: 60,
                    height: 80,
                    background: '#f5f5f5',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {book.coverUrl ? (
                      <img
                        src={book.coverUrl}
                        alt={book.title}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          borderRadius: 4
                        }}
                      />
                    ) : (
                      <span style={{ color: '#999', fontSize: 24 }}>📚</span>
                    )}
                  </div>

                  {/* Book Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{
                      margin: '0 0 4px 0',
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#333'
                    }}>
                      {book.title}
                    </h3>

                    {book.author && (
                      <p style={{
                        margin: '0 0 4px 0',
                        color: '#666',
                        fontSize: 14
                      }}>
                        by {book.author}
                      </p>
                    )}

                    <div style={{
                      display: 'flex',
                      gap: 12,
                      fontSize: 13,
                      color: '#888'
                    }}>
                      {book.publicationYear && <span>{book.publicationYear}</span>}
                      {book.publisher && <span>{book.publisher}</span>}
                      {book.isbn && <span>ISBN: {book.isbn}</span>}
                      <span style={{
                        background: book.source === 'openlibrary' ? '#4CAF50' : '#2196F3',
                        color: '#fff',
                        padding: '2px 6px',
                        borderRadius: 3,
                        fontSize: 11,
                        textTransform: 'uppercase'
                      }}>
                        {book.source}
                      </span>
                    </div>

                    {book.description && (
                      <p style={{
                        margin: '8px 0 0 0',
                        color: '#666',
                        fontSize: 14,
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden'
                      }}>
                        {book.description}
                      </p>
                    )}
                  </div>

                  {/* Checkbox */}
                  <div style={{
                    width: 20,
                    height: 20,
                    border: `2px solid ${isSelected ? '#2a4d8f' : '#ccc'}`,
                    borderRadius: 4,
                    background: isSelected ? '#2a4d8f' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {isSelected && (
                      <span style={{ color: '#fff', fontSize: 14, fontWeight: 'bold' }}>✓</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {searchResults.length === 0 && !loading && searchQuery && (
            <div style={{
              textAlign: 'center',
              padding: 40,
              color: '#666'
            }}>
              <span style={{ fontSize: 48, marginBottom: 16, display: 'block' }}>🔍</span>
              <p>No books found. Try a different search term.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedBooks.size > 0 && (
          <div style={{
            padding: '20px 24px',
            borderTop: '1px solid #e0e0e0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ color: '#666' }}>
              {selectedBooks.size} book{selectedBooks.size !== 1 ? 's' : ''} selected
            </span>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setSelectedBooks(new Set())}
                style={{
                  background: '#6c757d',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 16px',
                  fontSize: 14,
                  cursor: 'pointer'
                }}
              >
                Clear Selection
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                style={{
                  background: importing ? '#6c757d' : '#28a745',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 20px',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: importing ? 'not-allowed' : 'pointer'
                }}
              >
                {importing ? 'Importing...' : 'Import Selected Books'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};