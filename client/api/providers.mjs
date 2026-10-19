// Provider documentation (reviewed 2026-10-14):
// https://openlibrary.org/dev/docs/api/search
// https://openlibrary.org/developers/api
// https://developers.google.com/books/docs/v1/reference/volumes/list
// https://www.omdbapi.com/
// https://developer.themoviedb.org/reference/search-tv
// https://developer.themoviedb.org/reference/tv-season-details
// https://developer.themoviedb.org/docs/rate-limiting
// https://developer.trakt.tv/ (current; legacy endpoint reference: https://trakt.docs.apiary.io/)
import { validatePublicUrl } from '../domain/content.mjs';

const ORIGINS = Object.freeze({
  openlibrary: 'https://openlibrary.org',
  googlebooks: 'https://www.googleapis.com',
  omdb: 'https://www.omdbapi.com',
  tmdb: 'https://api.themoviedb.org',
  trakt: 'https://api.trakt.tv',
});
const MEDIA_SOURCES = ['omdb', 'tmdb', 'trakt'];
const BOOK_SOURCES = ['openlibrary', 'googlebooks'];

export class ProviderError extends Error {
  constructor(message, { status = 502, code = 'provider_failed', source, retryAfter } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.code = code;
    this.source = source;
    this.retryAfter = retryAfter;
  }
}

function invalid(message) {
  return new ProviderError(message, { status: 400, code: 'invalid_provider_input' });
}
function text(value) {
  return typeof value === 'string' && value !== 'N/A' ? value : undefined;
}
function number(value) {
  if (value === undefined || value === null || value === '' || value === 'N/A') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function year(value) {
  const parsed = typeof value === 'string' ? number(value.match(/\b\d{4}\b/)?.[0]) : number(value);
  return parsed !== undefined && parsed >= 1000 && parsed <= 9999 ? parsed : undefined;
}
function inputText(value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw invalid(`Invalid ${name}`);
  }
  return value.trim();
}
function id(value, name, pattern) {
  const clean = inputText(String(value ?? ''), name, 150);
  if (!pattern.test(clean)) throw invalid(`Invalid ${name}`);
  return clean;
}
function sources(value, supported, defaults) {
  if (value === undefined) return defaults;
  if (!Array.isArray(value) || value.length === 0 || value.length > 5 || value.some(source => !supported.includes(source))) {
    throw invalid('Invalid provider sources');
  }
  return [...new Set(value)];
}
function safeCover(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    // Providers sometimes return HTTP image links. Only expose HTTPS links to the UI.
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return validatePublicUrl(url.href).href;
  } catch { return undefined; }
}
function tmdbImage(path) {
  return typeof path === 'string' && /^\/[A-Za-z0-9_.-]+$/.test(path)
    ? `https://image.tmdb.org/t/p/w500${path}` : undefined;
}
function detectSeries(title, subtitle) {
  const full = `${title}${subtitle ? ` ${subtitle}` : ''}`;
  const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  const patterns = [
    /(.+?):\s*.*?\b(?:book|volume|vol\.?|part|episode)\s+(\d+|[ivxlcdm]+)\b/i,
    /\b(?:book|volume|vol\.?|part|episode)\s+(\d+|[ivxlcdm]+)\s+of\s+(.+)/i,
    /(.+?)\s+(?:book|volume|vol\.?|part|episode)\s+(\d+|[ivxlcdm]+)\b/i,
    /(?:\b(?:book|volume|vol\.?|part|episode)\s+|#\s*)(\d+|[ivxlcdm]+)\b/i,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = full.match(patterns[i]);
    if (!match) continue;
    const numeral = match[i === 1 || i === 3 ? 1 : 2].toLowerCase();
    const seriesNumber = roman[numeral] ?? (/^\d+$/.test(numeral) ? number(numeral) : undefined);
    if (seriesNumber === undefined) continue;
    return { seriesName: i === 3 ? undefined : match[i === 1 ? 2 : 1].trim(), seriesNumber, isSeriesBook: true };
  }
  return { isSeriesBook: false };
}
function openLibraryKey(value) {
  const clean = inputText(value, 'Open Library ID', 100).replace(/\.json$/, '');
  if (/^OL\d+W$/.test(clean)) return `/works/${clean}`;
  if (/^OL\d+M$/.test(clean)) return `/books/${clean}`;
  if (!/^\/(?:works\/OL\d+W|books\/OL\d+M)$/.test(clean)) throw invalid('Invalid Open Library ID');
  return clean;
}
function mapOpenLibrary(book) {
  const title = text(book.title) || 'Unknown Title';
  const cover = number(book.cover_i ?? book.covers?.[0]);
  return {
    title,
    author: text(book.author_name?.[0] ?? book.author_alternative_name?.[0] ?? book.authors?.[0]?.name),
    publisher: text(book.publisher?.[0] ?? book.publishers?.[0]),
    isbn: text(book.isbn?.[0] ?? book.isbn_13?.[0] ?? book.isbn_10?.[0]),
    publicationYear: year(book.first_publish_year ?? book.first_publish_date ?? book.publish_date),
    coverUrl: cover && cover > 0 ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg` : undefined,
    description: text(book.description?.value ?? book.description ?? book.first_sentence?.[0]),
    externalId: book.key ? openLibraryKey(book.key) : undefined,
    source: 'openlibrary',
    ...detectSeries(title),
  };
}
function mapGoogleBooks(item) {
  const volume = item.volumeInfo ?? {};
  const title = text(volume.title) || 'Unknown Title';
  const identifiers = Array.isArray(volume.industryIdentifiers) ? volume.industryIdentifiers : [];
  return {
    title,
    author: text(volume.authors?.[0]),
    publisher: text(volume.publisher),
    isbn: text(identifiers.find(item => item.type === 'ISBN_13')?.identifier ?? identifiers.find(item => item.type === 'ISBN_10')?.identifier),
    publicationYear: year(volume.publishedDate),
    coverUrl: safeCover(volume.imageLinks?.large ?? volume.imageLinks?.medium ?? volume.imageLinks?.small ?? volume.imageLinks?.thumbnail),
    description: text(volume.description),
    externalId: text(item.id),
    source: 'googlebooks',
    ...detectSeries(title, volume.subtitle),
  };
}
function mapOMDb(data) {
  const imdb = typeof data.imdbID === 'string' && /^tt\d+$/.test(data.imdbID) ? data.imdbID : undefined;
  return {
    title: text(data.Title), year: year(data.Year), description: text(data.Plot),
    coverImageUrl: safeCover(data.Poster), releaseDate: text(data.Released), runtime: number(data.Runtime),
    genres: text(data.Genre)?.split(', ').filter(Boolean), source: 'OMDB',
    sources: [{ url: imdb ? `https://www.imdb.com/title/${imdb}/` : 'https://www.omdbapi.com/', confidence: 0.8, note: 'OMDb metadata. Provider fields may be incomplete and have not been independently verified.' }],
  };
}
function mapTMDB(data, kind, item, path) {
  const specialized = kind === 'season' || kind === 'episode';
  return {
    title: specialized ? (text(item.Title) || text(item.DisplayName)) : text(data.title ?? data.name),
    year: year(data.release_date ?? data.first_air_date ?? data.air_date),
    description: text(data.overview), coverImageUrl: tmdbImage(data.poster_path ?? data.still_path),
    releaseDate: text(data.release_date ?? data.first_air_date ?? data.air_date),
    runtime: number(data.runtime ?? data.episode_run_time?.[0]),
    genres: Array.isArray(data.genres) ? data.genres.map(genre => text(genre.name)).filter(Boolean) : undefined,
    source: specialized ? `TMDB (${kind === 'season' ? 'Season' : 'Episode'})` : 'TMDB',
    sources: [{ url: `https://www.themoviedb.org${path.replace(/^\/3/, '')}`, confidence: 0.8, note: 'TMDB metadata. Linked IDs and title matches can be incorrect; review the proposed fields before applying.' }],
  };
}
function mapTraktMetadata(data, kind, item, path) {
  return {
    title: kind === 'season' || kind === 'episode' ? (text(item.Title) || text(item.DisplayName)) : text(data.title),
    year: year(data.year), description: text(data.overview),
    releaseDate: text(data.released ?? data.first_aired), runtime: number(data.runtime),
    genres: Array.isArray(data.genres) ? data.genres.filter(value => typeof value === 'string') : undefined,
    source: 'TRAKT',
    sources: [{ url: `https://trakt.tv${path}`, confidence: 0.8, note: 'Trakt metadata. Provider fields may be incomplete and title matches have not been independently verified.' }],
  };
}
function mapTraktListItem(item) {
  if (!['movie', 'show', 'season', 'episode'].includes(item?.type)) return null;
  const media = item.type === 'movie' ? item.movie : item.show;
  const part = item.type === 'season' ? item.season : item.type === 'episode' ? item.episode : undefined;
  if (!media || !text(media.title) || !Number.isInteger(media.ids?.trakt)) {
    throw new ProviderError('Invalid Trakt list response', { source: 'trakt', code: 'provider_response_invalid' });
  }
  const ids = { trakt: media.ids.trakt };
  for (const name of ['tmdb', 'tvdb']) if (Number.isInteger(media.ids[name])) ids[name] = media.ids[name];
  if (typeof media.ids.imdb === 'string' && /^tt\d+$/.test(media.ids.imdb)) ids.imdb = media.ids.imdb;
  let formattedTitle = `${media.title}${year(media.year) ? ` (${year(media.year)})` : ''}`;
  if (item.type === 'season') formattedTitle += ` Season ${part?.number}`;
  if (item.type === 'episode') formattedTitle += ` S${String(part?.season).padStart(2, '0')}E${String(part?.number).padStart(2, '0')}`;
  if (part && (!Number.isInteger(part.number) || part.number < 0 || (item.type === 'episode' && !Number.isInteger(part.season)))) {
    throw new ProviderError('Invalid Trakt list response', { source: 'trakt', code: 'provider_response_invalid' });
  }
  return {
    type: item.type, ids, title: media.title, formattedTitle, year: year(media.year),
    ...(item.type === 'season' ? { season: part.number } : {}),
    ...(item.type === 'episode' ? { season: part.season, episode: part.number, episodeTitle: text(part.title) } : {}),
  };
}
function mediaKind(value) {
  const type = String(Array.isArray(value) ? value[0] : value ?? '').toLowerCase();
  if (type === 'season' || type === 'tvseason') return 'season';
  if (type === 'episode' || type === 'tvepisode') return 'episode';
  if (type.includes('movie') || type.includes('film')) return 'movie';
  if (type === 'show' || type.includes('tv') || type.includes('series')) return 'show';
  return 'unknown';
}
function partNumbers(item, kind) {
  const labels = [item.Subtitle, item.DisplayName].filter(value => typeof value === 'string');
  for (const label of labels) {
    const match = kind === 'season' ? label.match(/Season\s+(\d+)|S(\d{1,3})/i) : label.match(/S(\d{1,3})E(\d{1,4})/i);
    if (match) return { season: number(match[1] ?? match[2]), episode: kind === 'episode' ? number(match[2]) : undefined };
  }
  return {};
}
function externalIds(value) {
  if (!value) return {};
  if (typeof value !== 'string' || value.length > 10000) throw invalid('Invalid external links');
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const ids = {};
      for (const source of ['imdb', 'tmdb', 'trakt', 'tvdb']) {
        if (typeof parsed[source] === 'string' || typeof parsed[source] === 'number') ids[source] = String(parsed[source]);
      }
      ids.imdb = ids.imdb?.match(/(?:imdb\.com\/title\/|^)(tt\d+)/)?.[1] ?? ids.imdb;
      return ids;
    }
  } catch { /* Legacy links are plain text. */ }
  return {
    imdb: value.match(/imdb\.com\/title\/(tt\d+)/i)?.[1],
    tmdb: value.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/i)?.[1],
    trakt: value.match(/trakt\.tv\/(?:movies|shows)\/([a-zA-Z0-9-]+)/i)?.[1],
    tvdb: value.match(/thetvdb\.com\/(?:series|movies)\/([a-zA-Z0-9-]+)/i)?.[1],
  };
}
function titleQuery(value) {
  const title = inputText(value, 'title');
  return { title: title.replace(/\s*\(\d{4}\)$/, ''), year: title.match(/\((\d{4})\)$/)?.[1] };
}
function matchesTitle(actual, expected) {
  if (!actual || !expected) return false;
  const normalize = value => value.toLowerCase().replace(/\(\d{4}\)/g, '').trim();
  const a = normalize(actual), e = normalize(expected);
  return a === e || e.includes(a) || a === e.split(':')[0].trim();
}
function retrySeconds(value) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)) : undefined;
}

/** Fixed-origin, bounded provider access. Gateway must authorize before execute and each beforeFetch. */
export function createProviderService({
  keys = {}, fetchImpl = globalThis.fetch, timeoutMs = 12000, operationTimeoutMs = 30000,
  maxBytes = 2 * 1024 * 1024, maxAttempts = 3, maxRetryDelayMs = 2000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const secrets = Object.fromEntries(['omdb', 'tmdb', 'trakt', 'googlebooks'].map(source => [source, typeof keys[source] === 'string' ? keys[source].trim() : '']));
  const limits = new Map();

  function requireKey(source) {
    if (!secrets[source]) throw new ProviderError(`${source.toUpperCase()} provider is not configured`, { status: 503, code: 'provider_not_configured', source });
  }
  async function request(source, path, query, context) {
    const url = new URL(path, ORIGINS[source]);
    if (url.origin !== ORIGINS[source] || url.protocol !== 'https:' || url.username || url.password) throw invalid('Invalid provider path');
    for (const [name, value] of Object.entries(query ?? {})) if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
    // Only provider credentials are attached here. Caller headers/tokens are never accepted.
    const headers = { Accept: 'application/json' };
    if (source === 'trakt') {
      requireKey(source); headers['trakt-api-version'] = '2'; headers['trakt-api-key'] = secrets.trakt;
    } else if (source === 'omdb' || source === 'tmdb') {
      requireKey(source); url.searchParams.set(source === 'omdb' ? 'apikey' : 'api_key', secrets[source]);
    } else if (source === 'googlebooks' && secrets.googlebooks) url.searchParams.set('key', secrets.googlebooks);
    const currentLimit = limits.get(source);
    if (currentLimit?.resetTime > Date.now()) {
      throw new ProviderError(`${source.toUpperCase()} provider is rate limited`, { status: 429, code: 'provider_rate_limited', source, retryAfter: Math.ceil((currentLimit.resetTime - Date.now()) / 1000) });
    }
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (context.signal?.aborted || Date.now() >= context.deadline) throw new ProviderError('Provider request cancelled or timed out', { status: 504, code: 'provider_timeout', source });
      await context.beforeFetch?.({ source, operation: context.operation });
      if (context.signal?.aborted || Date.now() >= context.deadline) throw new ProviderError('Provider request cancelled or timed out', { status: 504, code: 'provider_timeout', source });
      const controller = new AbortController();
      const abort = () => controller.abort();
      context.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, Math.min(timeoutMs, Math.max(1, context.deadline - Date.now())));
      let error;
      try {
        const response = await fetchImpl(url.href, { method: 'GET', headers, redirect: 'error', signal: controller.signal });
        if (response.redirected || (response.url && new URL(response.url).origin !== ORIGINS[source])) {
          await response.body?.cancel();
          throw new ProviderError('Provider redirect rejected', { code: 'provider_redirect_rejected', source });
        }
        if (!response.ok) {
          const retryAfter = retrySeconds(response.headers.get('retry-after'));
          await response.body?.cancel();
          if (response.status === 404) return null;
          throw new ProviderError(`${source.toUpperCase()} provider request failed`, {
            status: response.status === 429 || response.status === 420 ? 429 : 502,
            code: response.status === 429 || response.status === 420 ? 'provider_rate_limited' :
              response.status === 401 || response.status === 403 ? 'provider_auth_failed' :
              response.status >= 500 ? 'provider_failed' : 'provider_request_rejected', source, retryAfter,
          });
        }
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          await response.body?.cancel();
          throw new ProviderError('Provider response is too large', { code: 'provider_response_too_large', source });
        }
        const reader = response.body?.getReader();
        if (!reader) throw new ProviderError('Empty provider response', { code: 'provider_response_invalid', source });
        const chunks = [];
        let bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) { await reader.cancel(); throw new ProviderError('Provider response is too large', { code: 'provider_response_too_large', source }); }
          chunks.push(value);
        }
        const buffer = new Uint8Array(bytes);
        let offset = 0;
        for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
        let data;
        try { data = JSON.parse(new TextDecoder().decode(buffer)); }
        catch { throw new ProviderError('Invalid provider JSON response', { code: 'provider_response_invalid', source }); }
        if (!data || typeof data !== 'object') throw new ProviderError('Invalid provider response', { code: 'provider_response_invalid', source });
        if (source === 'omdb' && data.Response === 'False') {
          if (/limit exceeded/i.test(String(data.Error))) throw new ProviderError('OMDB daily limit exceeded', { status: 429, code: 'provider_rate_limited', source, retryAfter: 86400 });
          if (/not found/i.test(String(data.Error))) return null;
          throw new ProviderError('OMDB provider rejected the request', { code: 'provider_failed', source });
        }
        limits.delete(source);
        return data;
      } catch (caught) {
        error = caught instanceof ProviderError ? caught : new ProviderError(controller.signal.aborted ? 'Provider request timed out' : 'Provider request failed', { status: controller.signal.aborted ? 504 : 502, code: controller.signal.aborted ? 'provider_timeout' : 'provider_failed', source });
      } finally {
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', abort);
      }
      const delay = (error.retryAfter !== undefined ? error.retryAfter * 1000 : 250 * 2 ** (attempt - 1));
      const retryable = error.code === 'provider_rate_limited' || error.code === 'provider_failed' || error.code === 'provider_timeout';
      if (!retryable || attempt >= maxAttempts || delay > maxRetryDelayMs || Date.now() + delay >= context.deadline || context.signal?.aborted) {
        if (error.code === 'provider_rate_limited') limits.set(source, { source, isLimited: true, retryAfter: error.retryAfter ?? 1, resetTime: Date.now() + (error.retryAfter ?? 1) * 1000 });
        throw error;
      }
      await sleep(delay);
    }
  }

  async function booksSearch(input, context) {
    const query = inputText(input.query, 'book query');
    const limit = input.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 40) throw invalid('Book limit must be between 1 and 40');
    const selected = sources(input.sources, BOOK_SOURCES, BOOK_SOURCES);
    const results = [];
    const errors = [];
    for (const source of selected) {
      try {
        if (source === 'openlibrary') {
          const data = await request(source, '/search.json', { q: query, limit, fields: 'key,title,author_name,author_alternative_name,publisher,isbn,first_publish_year,cover_i,first_sentence' }, context);
          if (data && !Array.isArray(data.docs)) throw new ProviderError('Invalid Open Library response', { code: 'provider_response_invalid', source });
          results.push(...(data?.docs ?? []).slice(0, limit).map(mapOpenLibrary));
        } else {
          const data = await request(source, '/books/v1/volumes', { q: query, maxResults: limit }, context);
          if (data?.items !== undefined && !Array.isArray(data.items)) throw new ProviderError('Invalid Google Books response', { code: 'provider_response_invalid', source });
          results.push(...(data?.items ?? []).slice(0, limit).map(mapGoogleBooks));
        }
      } catch (error) { if (!(error instanceof ProviderError)) throw error; errors.push(error); }
    }
    if (errors.length === selected.length) throw errors[0];
    return results.filter((book, index, all) => index === all.findIndex(candidate => candidate.title === book.title && candidate.author === book.author)).slice(0, limit);
  }

  async function booksDetails(input, context) {
    if (!BOOK_SOURCES.includes(input.source)) throw invalid('Invalid book source');
    if (input.source === 'googlebooks') {
      const externalId = id(input.externalId, 'Google Books ID', /^[A-Za-z0-9_-]+$/);
      const data = await request('googlebooks', `/books/v1/volumes/${externalId}`, {}, context);
      return data ? mapGoogleBooks(data) : null;
    }
    const externalId = openLibraryKey(input.externalId);
    const data = await request('openlibrary', `${externalId}.json`, {}, context);
    if (!data) return null;
    const result = mapOpenLibrary(data);
    // Works store author references, not author names. Resolve the first author on the fixed origin.
    const authorKey = data.authors?.[0]?.author?.key ?? data.authors?.[0]?.key;
    if (!result.author && typeof authorKey === 'string' && /^\/authors\/OL\d+A$/.test(authorKey)) {
      try {
        const author = await request('openlibrary', `${authorKey}.json`, {}, context);
        result.author = text(author?.name);
      } catch (error) { if (!(error instanceof ProviderError)) throw error; }
    }
    return result;
  }

  async function omdbLookup(identifier, item, context) {
    const query = { plot: 'full' };
    if (identifier) query.i = id(identifier.startsWith('tt') ? identifier : `tt${identifier}`, 'IMDb ID', /^tt\d+$/);
    else {
      const search = titleQuery(item.Title || item.DisplayName);
      query.t = search.title; query.y = search.year;
      const kind = mediaKind(item.MediaType);
      if (kind !== 'unknown') query.type = kind === 'movie' ? 'movie' : 'series';
    }
    const kind = mediaKind(item.MediaType);
    if (kind === 'episode') {
      const parts = partNumbers(item, kind);
      if (parts.season !== undefined && parts.episode !== undefined) { query.Season = parts.season; query.Episode = parts.episode; }
    }
    const data = await request('omdb', '/', query, context);
    return data?.Response === 'True' ? mapOMDb(data) : null;
  }

  async function tmdbLookup(identifier, item, context) {
    const kind = mediaKind(item.MediaType);
    const kinds = kind === 'unknown' ? ['movie', 'show'] : [kind];
    for (const candidateKind of kinds) {
      const endpoint = candidateKind === 'movie' ? 'movie' : 'tv';
      let tmdbId = identifier ? id(identifier, 'TMDB ID', /^\d+$/) : undefined;
      if (!tmdbId) {
        const search = titleQuery(item.Title || item.DisplayName);
        const data = await request('tmdb', `/3/search/${endpoint}`, { query: search.title, [endpoint === 'movie' ? 'year' : 'first_air_date_year']: search.year }, context);
        if (!Array.isArray(data?.results)) continue;
        const match = data.results.find(candidate => matchesTitle(candidate.title ?? candidate.name, search.title));
        if (!match?.id) continue;
        tmdbId = id(match.id, 'TMDB ID', /^\d+$/);
      }
      let path = `/3/${endpoint}/${tmdbId}`;
      if (candidateKind === 'season' || candidateKind === 'episode') {
        const parts = partNumbers(item, candidateKind);
        if (parts.season === undefined || (candidateKind === 'episode' && parts.episode === undefined)) continue;
        path += `/season/${parts.season}${candidateKind === 'episode' ? `/episode/${parts.episode}` : ''}`;
      }
      const data = await request('tmdb', path, {}, context);
      if (data?.id) return mapTMDB(data, candidateKind, item, path);
    }
    return null;
  }

  async function traktLookup(identifier, item, context) {
    const kind = mediaKind(item.MediaType);
    let slug = identifier;
    let candidateKind = kind;
    if (!slug) {
      const search = titleQuery(item.Title || item.DisplayName);
      const type = kind === 'movie' ? 'movie' : kind === 'unknown' ? 'movie,show' : 'show';
      const data = await request('trakt', `/search/${type}`, { query: search.title, years: search.year, extended: 'full', limit: 10 }, context);
      if (!Array.isArray(data)) throw new ProviderError('Invalid Trakt search response', { code: 'provider_response_invalid', source: 'trakt' });
      const match = data.find(candidate => matchesTitle(candidate[candidate.type]?.title, search.title));
      if (!match) return null;
      slug = match[match.type]?.ids?.slug ?? match[match.type]?.ids?.trakt;
      if (candidateKind === 'unknown') candidateKind = match.type;
    }
    slug = id(slug, 'Trakt ID', /^[A-Za-z0-9_-]+$/);
    const endpoints = candidateKind === 'unknown' ? ['movie', 'show'] : [candidateKind];
    for (const type of endpoints) {
      let path = `/${type === 'movie' ? 'movies' : 'shows'}/${slug}`;
      if (type === 'season' || type === 'episode') {
        const parts = partNumbers(item, type);
        if (parts.season === undefined || (type === 'episode' && parts.episode === undefined)) continue;
        if (type === 'season') {
          const seasons = await request('trakt', `${path}/seasons`, { extended: 'full' }, context);
          if (!Array.isArray(seasons)) continue;
          const season = seasons.find(candidate => candidate.number === parts.season);
          if (season) return mapTraktMetadata(season, type, item, `${path}/seasons/${parts.season}`);
          continue;
        }
        path += `/seasons/${parts.season}/episodes/${parts.episode}`;
      }
      const data = await request('trakt', path, { extended: 'full' }, context);
      if (data?.title) return mapTraktMetadata(data, type, item, path);
    }
    return null;
  }

  async function mediaLookup(input, context) {
    const item = input.mediaItem;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid('Invalid media item');
    inputText(item.Title || item.DisplayName, 'media title');
    for (const name of ['Subtitle', 'DisplayName', 'Title']) if (item[name] !== undefined && (typeof item[name] !== 'string' || item[name].length > 1000)) throw invalid(`Invalid media ${name}`);
    const preferred = sources(input.preferredSources, [...MEDIA_SOURCES, 'imdb', 'tvdb'], MEDIA_SOURCES).map(source => source === 'imdb' ? 'omdb' : source);
    const selected = [...new Set(preferred)].filter(source => MEDIA_SOURCES.includes(source));
    const links = externalIds(item.ExternalLinks);
    const errors = [];
    const lookup = { omdb: omdbLookup, tmdb: tmdbLookup, trakt: traktLookup };
    for (const byId of [true, false]) {
      for (const source of selected) {
        const identifier = links[source === 'omdb' ? 'imdb' : source];
        if (byId && !identifier) continue;
        try {
          const data = await lookup[source](byId ? identifier : undefined, item, context);
          if (data && matchesTitle(data.title, item.Title || item.DisplayName)) {
            data.sources = data.sources.map(sourceInfo => ({ ...sourceInfo, confidence: byId ? 0.85 : 0.65,
              note: `${sourceInfo.note} ${byId ? 'Resolved using a linked provider ID.' : 'Resolved by title search; the first matching candidate may still refer to another work.'}` }));
            return data;
          }
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error;
          if (error.code === 'invalid_provider_input') continue; // A malformed legacy ID may still be resolved by title.
          errors.push(error);
        }
      }
    }
    if (errors.length) throw errors.find(error => error.code === 'provider_rate_limited') ?? errors[0];
    return null;
  }

  async function traktList(input, context) {
    const username = id(input.username, 'Trakt username', /^[A-Za-z0-9_-]+$/);
    const slug = id(input.listSlug, 'Trakt list slug', /^[A-Za-z0-9_-]+$/);
    const data = await request('trakt', `/users/${username}/lists/${slug}/items`, {}, context);
    if (!data) throw new ProviderError('Trakt list was not found', { status: 404, code: 'provider_not_found', source: 'trakt' });
    if (!Array.isArray(data)) throw new ProviderError('Invalid Trakt list response', { code: 'provider_response_invalid', source: 'trakt' });
    if (data.length > 5000) throw new ProviderError('Trakt list exceeds the import limit', { status: 413, code: 'provider_response_too_large', source: 'trakt' });
    return data.map(mapTraktListItem).filter(Boolean);
  }

  const operations = { 'books.search': booksSearch, 'books.details': booksDetails, 'media.lookup': mediaLookup, 'trakt.list': traktList };
  return {
    async execute(operation, input = {}, { beforeFetch, signal } = {}) {
      const handler = Object.hasOwn(operations, operation) ? operations[operation] : undefined;
      if (!handler) throw invalid('Unknown provider operation');
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Invalid provider input');
      return handler(input, { beforeFetch, signal, operation, deadline: Date.now() + operationTimeoutMs });
    },
    status() {
      return Object.fromEntries(Object.keys(ORIGINS).map(source => [source, {
        configured: BOOK_SOURCES.includes(source) || Boolean(secrets[source]),
        rateLimit: limits.has(source) ? { ...limits.get(source), resetTime: new Date(limits.get(source).resetTime).toISOString() } : undefined,
      }]));
    },
  };
}
