/** Application contract shared by browser adapters and the native HTTP gateway. */
export class DomainError extends Error {
  constructor(code, message, status = 400, details) {
    super(message); this.code = code; this.status = status; this.details = details;
  }
}
export const TYPES = ['Timeline', 'MediaItem', 'BookMediaItem', 'TimelineEntry'];
const common = ['Name', 'DisplayName', 'Description'];
const media = [...common, 'Title', 'Subtitle', 'MediaType', 'ReleaseDate', 'Year', 'ChronologicalDate', 'CoverImageUrl', 'Duration', 'Genre', 'Rating', 'ExternalLinks', 'Tags', 'SeriesName'];
export const FIELDS = Object.freeze({
  Timeline: [...common, 'SortOrder', 'TimelineType', 'IsVisible', 'CoverImageUrl'],
  MediaItem: media,
  BookMediaItem: [...media, 'Author', 'Publisher', 'ISBN', 'PublicationYear', 'BookSeriesNumber'],
  TimelineEntry: [...common, 'MediaItem', 'Position', 'ChronologicalDate', 'ChronologicalDescription', 'ReleaseOrderPosition', 'Notes', 'EntryLabel', 'IsOptional', 'ArcGroup', 'Importance'],
});
export const CHOICES = {
  SortOrder: ['chronological', 'release'], TimelineType: ['chronological', 'publisher-series'],
  MediaType: ['movie', 'tvepisode', 'tvseason', 'tvseries', 'show', 'season', 'episode', 'book', 'comic', 'videogame', 'podcast', 'documentary', 'other'],
  EntryLabel: ['firstappearance', 'mainstory', 'flashback', 'cameo', 'reference', 'other'],
  Importance: ['essential', 'important', 'optional', 'skipok'],
  Genre: ['action', 'adventure', 'comedy', 'drama', 'fantasy', 'horror', 'mystery', 'romance', 'scifi', 'thriller', 'documentary', 'other'],
};
const integers = { Position: [0, 2147483647], ReleaseOrderPosition: [0, 2147483647], MediaItem: [1, 2147483647], Year: [0, 2100], Duration: [0, 2147483647], Rating: [0, 10], PublicationYear: [0, 2100], BookSeriesNumber: [1, 2147483647] };
const dates = new Set(['ReleaseDate', 'ChronologicalDate']);
const bools = new Set(['IsVisible', 'IsOptional']);
export function assertObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new DomainError('invalid_input', 'Expected a JSON object.');
}
export function assertId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new DomainError('invalid_target', 'Expected a positive content ID.');
  return value;
}
export function safeName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\\/<>:"|?*\x00-\x1f]/.test(value) || value === '.' || value === '..' || /[. ]$/.test(value)) throw new DomainError('invalid_name', 'Name must be a single safe repository path segment.');
  return value;
}
export function validateFields(type, input, { create = false, choices = CHOICES } = {}) {
  if (!TYPES.includes(type)) throw new DomainError('invalid_type', 'Unsupported application content type.');
  assertObject(input); const result = {};
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!FIELDS[type].includes(field)) throw new DomainError('invalid_field', `Field ${field} is not writable on ${type}.`);
    if (field === 'Name') { result[field] = safeName(value); continue; }
    if (integers[field]) {
      const [min, max] = integers[field];
      if (!Number.isInteger(value) || value < min || value > max) throw new DomainError('invalid_field', `${field} must be an integer between ${min} and ${max}.`);
    } else if (bools.has(field)) {
      if (typeof value !== 'boolean') throw new DomainError('invalid_field', `${field} must be boolean.`);
    } else if (dates.has(field)) {
      result[field] = normalizeDateTime(field, value); continue;
    } else if (choices[field]) {
      const values = Array.isArray(value) ? value : [value];
      if (field !== 'Genre' && values.length > 1) throw new DomainError('invalid_field', `${field} accepts one choice.`);
      if (values.some(v => typeof v !== 'string' || (v !== '' && !choices[field].includes(v)))) throw new DomainError('invalid_field', `Unsupported ${field} choice.`);
    } else if (typeof value !== 'string' || value.length > (['Description', 'Notes', 'ExternalLinks', 'Tags'].includes(field) ? 100000 : field === 'ChronologicalDescription' ? 200 : 1000)) {
      throw new DomainError('invalid_field', `${field} has an invalid string value or length.`);
    }
    if (field === 'CoverImageUrl' && value) validatePublicUrl(value);
    if (field === 'ExternalLinks' && value) {
      let links; try { links = JSON.parse(value); } catch { throw new DomainError('invalid_field', 'ExternalLinks must contain a JSON object.'); }
      assertObject(links);
      for (const link of Object.values(links)) if (typeof link !== 'string') throw new DomainError('invalid_field', 'ExternalLinks values must be strings.');
    }
    result[field] = value;
  }
  if (create) {
    safeName(result.Name);
    if (!result.DisplayName?.trim()) throw new DomainError('invalid_field', 'DisplayName is required.');
    if (type === 'TimelineEntry') assertId(result.MediaItem);
    if (type === 'BookMediaItem' && (Array.isArray(result.MediaType)?result.MediaType[0]:result.MediaType) !== 'book') throw new DomainError('invalid_field', 'BookMediaItem requires MediaType book.');
  }
  if (!Object.keys(result).length) throw new DomainError('empty_change', 'At least one writable field is required.');
  return result;
}
function normalizeDateTime(field, value) {
  if (value === null) return null;
  const invalid = () => { throw new DomainError('invalid_field', `${field} must use a real ISO calendar date and a supported DateTime value.`); };
  const parts = typeof value === 'string' && value.match(/^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?(Z|[+-]\d\d:\d\d)?)?$/);
  if (!parts) invalid();
  const [, year, month, day, hour = '00', minute = '00', second = '00', , zone] = parts;
  if (+year < 1 || +month < 1 || +month > 12 || +day < 1 || +day > 31 || +hour > 23 || +minute > 59 || +second > 59) invalid();
  const calendar = value.slice(0, 10);
  if (new Date(calendar + 'T00:00:00Z').toISOString().slice(0, 10) !== calendar) invalid();
  if (zone && zone !== 'Z') {
    const offsetHours = Number(zone.slice(1, 3)), offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 14 || offsetMinutes > 59 || offsetHours === 14 && offsetMinutes !== 0) invalid();
  }
  // Input supports millisecond precision. Date-only and unzoned datetime input
  // use UTC consistently; zoned input is normalized before it enters a plan.
  const date = new Date(parts[4] === undefined ? calendar + 'T00:00:00Z' : value + (zone ? '' : 'Z'));
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) invalid();
  return date.toISOString().replace('.000Z', 'Z');
}
export function validatePublicUrl(value) {
  let url; try { url = new URL(value); } catch { throw new DomainError('invalid_url', 'Expected an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || /^(localhost|.*\.localhost|.*\.local)$/i.test(url.hostname) || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) throw new DomainError('invalid_url', 'Only public HTTPS origins are permitted.');
  return url;
}
export function projectPaths(root) {
  if (typeof root !== 'string' || !root.startsWith('/Root/Content/') || /\.\.|[\\?"'\x00-\x1f]/.test(root) || root.endsWith('/')) throw new DomainError('invalid_configuration', 'Invalid project root.', 503);
  return { root, timelines: root + '/Timelines', media: root + '/MediaLibrary' };
}
export function assertMembership(content, paths, { parent = false, type } = {}) {
  if (!content || !Number.isSafeInteger(content.Id) || typeof content.Path !== 'string') throw new DomainError('invalid_target', 'The repository did not return a readable target.', 403);
  const targetType = type || content.Type;
  const valid = parent
    ? content.Path === paths.timelines || content.Path === paths.media || content.Path.startsWith(paths.media + '/') || content.Type === 'Timeline' && content.Path.startsWith(paths.timelines + '/')
    : targetType === 'Timeline' ? content.Path.startsWith(paths.timelines + '/')
    : ['MediaItem', 'BookMediaItem'].includes(targetType) ? content.Path.startsWith(paths.media + '/')
    : targetType === 'TimelineEntry' && (content.Path.startsWith(paths.timelines + '/') || content.Path.startsWith(paths.root + '/TimelineEntries/'));
  if (!valid) throw new DomainError('project_boundary', 'Content is outside the application project/type boundary.', 403);
  return content;
}
export function fieldDiff(before, fields) {
  return Object.entries(fields).filter(([field, value]) => JSON.stringify(before[field] ?? null) !== JSON.stringify(value ?? null)).map(([field, after]) => ({ field, before: before[field] ?? null, after }));
}
export function metadataDiff(content, proposal, { overwrite = false, choices } = {}) {
  assertObject(proposal);
  if (!Array.isArray(proposal.sources) || !proposal.sources.length || proposal.sources.length > 20) throw new DomainError('invalid_sources', 'Metadata needs one or more source URLs and uncertainty notes.');
  const sources = proposal.sources.map(s => {
    assertObject(s); const sourceUrl=validatePublicUrl(s.url);
    if([...sourceUrl.searchParams.keys()].some(name=>/^(?:api[_-]?key|key|token|secret|authorization|access[_-]?token)$/i.test(name)))throw new DomainError('invalid_sources','Metadata sources must use public URLs without credential query parameters.');
    if (typeof s.note !== 'string' || s.note.length > 2000 || !Number.isFinite(s.confidence) || s.confidence < 0 || s.confidence > 1) throw new DomainError('invalid_sources', 'Each source needs note and confidence (0..1).');
    return { url: s.url, note: s.note, confidence: s.confidence };
  });
  const fields = validateFields(content.Type, proposal.fields, { choices });
  const protectedFields = new Set(['Name', 'Position', 'ReleaseOrderPosition', 'Notes', 'ChronologicalDate', 'ChronologicalDescription', 'MediaItem', 'IsVisible']);
  for (const field of Object.keys(fields)) if (protectedFields.has(field)) throw new DomainError('protected_editorial_field', `${field} requires an explicit editorial update, outside metadata enrichment.`);
  const accepted = Object.fromEntries(Object.entries(fields).filter(([f]) => overwrite || content[f] === undefined || content[f] === null || content[f] === '' || content[f] === 0 && ['Year','Duration','PublicationYear'].includes(f) || Array.isArray(content[f]) && !content[f].length));
  return { fields: accepted, diff: fieldDiff(content, accepted), sources, protected: Object.keys(fields).filter(f => !Object.hasOwn(accepted, f)) };
}
