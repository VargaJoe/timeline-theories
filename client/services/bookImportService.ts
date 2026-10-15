import { nativeRequest } from './nativeApi';

// Book import service for fetching book data from external APIs
export interface BookSearchResult {
  title: string;
  author?: string;
  publisher?: string;
  isbn?: string;
  publicationYear?: number;
  coverUrl?: string;
  description?: string;
  externalId?: string;
  source: 'openlibrary' | 'googlebooks';
  // Series detection
  seriesName?: string;
  seriesNumber?: number;
  isSeriesBook?: boolean;
}

export interface BookImportData {
  DisplayName: string;
  Title?: string;
  Description: string;
  Author?: string;
  Publisher?: string;
  ISBN?: string;
  PublicationYear?: number;
  CoverImageUrl?: string;
  MediaType: 'book';
  BookSeriesNumber?: number;
  // Series information
  SeriesName?: string;
}

/** Book metadata uses the authorized native gateway; provider keys stay on its host. */
export class BookImportService {
  static async searchOpenLibrary(query: string, limit: number = 10): Promise<BookSearchResult[]> {
    return nativeRequest<BookSearchResult[]>('/api/v1/providers/books/search', {
      method: 'POST', body: JSON.stringify({ query, sources: ['openlibrary'], limit }),
    });
  }

  static async searchGoogleBooks(query: string, limit: number = 10): Promise<BookSearchResult[]> {
    return nativeRequest<BookSearchResult[]>('/api/v1/providers/books/search', {
      method: 'POST', body: JSON.stringify({ query, sources: ['googlebooks'], limit }),
    });
  }

  static async searchBooks(query: string, sources: ('openlibrary' | 'googlebooks')[] = ['openlibrary', 'googlebooks'], limit: number = 10): Promise<BookSearchResult[]> {
    return nativeRequest<BookSearchResult[]>('/api/v1/providers/books/search', {
      method: 'POST', body: JSON.stringify({ query, sources, limit }),
    });
  }

  static convertToImportData(book: BookSearchResult): BookImportData {
    return {
      DisplayName: `${book.title}${book.publicationYear ? ` (${book.publicationYear})` : ''}`,
      Title: book.title,
      Description: book.description || 'No description available.',
      Author: book.author,
      Publisher: book.publisher,
      ISBN: book.isbn,
      PublicationYear: book.publicationYear,
      CoverImageUrl: book.coverUrl,
      MediaType: 'book',
      BookSeriesNumber: book.isSeriesBook ? book.seriesNumber : 1,
      SeriesName: book.seriesName,
    };
  }

  static async getBookDetails(externalId: string, source: 'openlibrary' | 'googlebooks'): Promise<BookSearchResult | null> {
    return nativeRequest<BookSearchResult | null>('/api/v1/providers/books/details', {
      method: 'POST', body: JSON.stringify({ externalId, source }),
    });
  }
}
