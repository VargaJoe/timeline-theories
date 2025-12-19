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

// API Response Types
interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  author_alternative_name?: string[];
  publisher?: string[];
  isbn?: string[];
  first_publish_year?: number;
  cover_i?: number;
  first_sentence?: string[];
  description?: { value?: string };
  key?: string;
}

interface OpenLibrarySearchResponse {
  docs: OpenLibraryDoc[];
}

interface GoogleBooksIndustryIdentifier {
  type: string;
  identifier: string;
}

interface GoogleBooksVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  industryIdentifiers?: GoogleBooksIndustryIdentifier[];
  publishedDate?: string;
  imageLinks?: {
    large?: string;
    medium?: string;
    small?: string;
    thumbnail?: string;
  };
  description?: string;
}

interface GoogleBooksItem {
  id: string;
  volumeInfo: GoogleBooksVolumeInfo;
}

interface GoogleBooksSearchResponse {
  items?: GoogleBooksItem[];
}

/**
 * Service for importing books from external APIs
 */
export class BookImportService {
  private static readonly OPEN_LIBRARY_API = 'https://openlibrary.org';
  private static readonly GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1';

  /**
   * Detect if a book belongs to a series and extract series information
   */
  private static detectSeriesInfo(title: string, subtitle?: string): { seriesName?: string; seriesNumber?: number; isSeriesBook: boolean } {
    const fullTitle = subtitle ? `${title} ${subtitle}` : title;
    
    // Common series patterns
    const seriesPatterns = [
      // "Book 1", "Volume 1", "#1", "Part 1", "Episode 1", etc.
      /\b(book|volume|vol\.?|#|part|episode)\s+(\d+|[ivxlcdm]+)\b/i,
      // "Series Name: Book 1"
      /(.+?):\s*(.+?)\s+(book|volume|vol\.?|#)\s+(\d+|[ivxlcdm]+)/i,
      // "Book 1 of Series Name"
      /(book|volume|vol\.?|#)\s+(\d+|[ivxlcdm]+)\s+of\s+(.+)/i,
      // "Series Name Book 1"
      /(.+?)\s+(book|volume|vol\.?|#)\s+(\d+|[ivxlcdm]+)/i
    ];

    for (const pattern of seriesPatterns) {
      const match = fullTitle.match(pattern);
      if (match) {
        let seriesName: string | undefined;
        let seriesNumber: number | undefined;

        if (pattern === seriesPatterns[0]) {
          // Simple "Book 1" pattern
          seriesNumber = this.parseRomanOrArabic(match[2]);
        } else if (pattern === seriesPatterns[1]) {
          // "Series Name: Book 1"
          seriesName = match[1].trim();
          seriesNumber = this.parseRomanOrArabic(match[4]);
        } else if (pattern === seriesPatterns[2]) {
          // "Book 1 of Series Name"
          seriesName = match[3].trim();
          seriesNumber = this.parseRomanOrArabic(match[2]);
        } else if (pattern === seriesPatterns[3]) {
          // "Series Name Book 1"
          seriesName = match[1].trim();
          seriesNumber = this.parseRomanOrArabic(match[3]);
        }

        if (seriesNumber !== undefined) {
          return {
            seriesName,
            seriesNumber,
            isSeriesBook: true
          };
        }
      }
    }

    return { isSeriesBook: false };
  }

  /**
   * Parse Roman numerals or Arabic numbers
   */
  private static parseRomanOrArabic(str: string): number | undefined {
    const romanNumerals: { [key: string]: number } = {
      'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5,
      'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10
    };

    const lower = str.toLowerCase();
    if (romanNumerals[lower]) {
      return romanNumerals[lower];
    }

    const arabic = parseInt(str, 10);
    return isNaN(arabic) ? undefined : arabic;
  }

  /**
   * Search for books using Open Library API
   */
  static async searchOpenLibrary(query: string, limit: number = 10): Promise<BookSearchResult[]> {
    try {
      const response = await fetch(`${this.OPEN_LIBRARY_API}/search.json?q=${encodeURIComponent(query)}&limit=${limit}`);

      if (!response.ok) {
        throw new Error(`Open Library API error: ${response.status}`);
      }

      const data: OpenLibrarySearchResponse = await response.json();

      return data.docs.map((book: OpenLibraryDoc) => {
        const title = book.title || 'Unknown Title';
        const seriesInfo = this.detectSeriesInfo(title);
        
        return {
          title,
          author: book.author_name?.[0] || book.author_alternative_name?.[0],
          publisher: book.publisher?.[0],
          isbn: book.isbn?.[0],
          publicationYear: book.first_publish_year,
          coverUrl: book.cover_i ? 
            `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg` : // Large cover
            undefined,
          description: typeof book.description === 'string' ? book.description : book.description?.value || book.first_sentence?.[0],
          externalId: book.key,
          source: 'openlibrary' as const,
          ...seriesInfo
        };
      });
    } catch (error) {
      console.error('Error searching Open Library:', error);
      throw new Error('Failed to search Open Library. Please try again.');
    }
  }

  /**
   * Search for books using Google Books API
   */
  static async searchGoogleBooks(query: string, limit: number = 10): Promise<BookSearchResult[]> {
    try {
      const response = await fetch(`${this.GOOGLE_BOOKS_API}/volumes?q=${encodeURIComponent(query)}&maxResults=${limit}`);

      if (!response.ok) {
        throw new Error(`Google Books API error: ${response.status}`);
      }

      const data: GoogleBooksSearchResponse = await response.json();

      return data.items?.map((item: GoogleBooksItem) => {
        const volumeInfo = item.volumeInfo;
        const title = volumeInfo.title || 'Unknown Title';
        const subtitle = volumeInfo.subtitle;
        const seriesInfo = this.detectSeriesInfo(title, subtitle);
        
        return {
          title,
          author: volumeInfo.authors?.[0],
          publisher: volumeInfo.publisher,
          isbn: volumeInfo.industryIdentifiers?.find((id: GoogleBooksIndustryIdentifier) => id.type === 'ISBN_13')?.identifier ||
                volumeInfo.industryIdentifiers?.find((id: GoogleBooksIndustryIdentifier) => id.type === 'ISBN_10')?.identifier,
          publicationYear: volumeInfo.publishedDate ? new Date(volumeInfo.publishedDate).getFullYear() : undefined,
          coverUrl: volumeInfo.imageLinks?.large || 
                     volumeInfo.imageLinks?.medium || 
                     volumeInfo.imageLinks?.small || 
                     volumeInfo.imageLinks?.thumbnail,
          description: volumeInfo.description,
          externalId: item.id,
          source: 'googlebooks' as const,
          ...seriesInfo
        };
      }) || [];
    } catch (error) {
      console.error('Error searching Google Books:', error);
      throw new Error('Failed to search Google Books. Please try again.');
    }
  }

  /**
   * Search books from multiple sources
   */
  static async searchBooks(query: string, sources: ('openlibrary' | 'googlebooks')[] = ['openlibrary', 'googlebooks'], limit: number = 10): Promise<BookSearchResult[]> {
    const results: BookSearchResult[] = [];

    for (const source of sources) {
      try {
        let sourceResults: BookSearchResult[] = [];

        if (source === 'openlibrary') {
          sourceResults = await this.searchOpenLibrary(query, limit);
        } else if (source === 'googlebooks') {
          sourceResults = await this.searchGoogleBooks(query, limit);
        }

        results.push(...sourceResults);
      } catch (error) {
        console.warn(`Failed to search ${source}:`, error);
        // Continue with other sources even if one fails
      }
    }

    // Remove duplicates based on title and author
    const uniqueResults = results.filter((book, index, self) =>
      index === self.findIndex(b => b.title === book.title && b.author === book.author)
    );

    return uniqueResults.slice(0, limit);
  }

  /**
   * Convert search result to import data format
   */
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
      SeriesName: book.seriesName
    };
  }

  /**
   * Get detailed book information by external ID
   */
  static async getBookDetails(externalId: string, source: 'openlibrary' | 'googlebooks'): Promise<BookSearchResult | null> {
    try {
      if (source === 'openlibrary') {
        const response = await fetch(`${this.OPEN_LIBRARY_API}${externalId}.json`);

        if (!response.ok) {
          throw new Error(`Open Library API error: ${response.status}`);
        }

        const data = await response.json();

        return {
          title: data.title || 'Unknown Title',
          author: data.authors?.[0]?.name,
          publisher: data.publishers?.[0],
          isbn: data.isbn_13?.[0] || data.isbn_10?.[0],
          publicationYear: data.first_publish_date ? new Date(data.first_publish_date).getFullYear() : undefined,
          coverUrl: data.covers?.[0] ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg` : undefined,
          description: data.description?.value || data.description,
          externalId: data.key,
          source: 'openlibrary'
        };
      } else if (source === 'googlebooks') {
        const response = await fetch(`${this.GOOGLE_BOOKS_API}/volumes/${externalId}`);

        if (!response.ok) {
          throw new Error(`Google Books API error: ${response.status}`);
        }

        const data = await response.json();
        const volumeInfo = data.volumeInfo;

        return {
          title: volumeInfo.title || 'Unknown Title',
          author: volumeInfo.authors?.[0],
          publisher: volumeInfo.publisher,
          isbn: volumeInfo.industryIdentifiers?.find((id: GoogleBooksIndustryIdentifier) => id.type === 'ISBN_13')?.identifier ||
                volumeInfo.industryIdentifiers?.find((id: GoogleBooksIndustryIdentifier) => id.type === 'ISBN_10')?.identifier,
          publicationYear: volumeInfo.publishedDate ? new Date(volumeInfo.publishedDate).getFullYear() : undefined,
          coverUrl: volumeInfo.imageLinks?.large || volumeInfo.imageLinks?.medium || volumeInfo.imageLinks?.small,
          description: volumeInfo.description,
          externalId: data.id,
          source: 'googlebooks'
        };
      }
    } catch (error) {
      console.error(`Error getting book details from ${source}:`, error);
    }

    return null;
  }
}