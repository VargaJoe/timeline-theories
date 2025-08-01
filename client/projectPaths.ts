// Project root and calculated content paths for SenseNet ECM
// Can be overridden by environment variables (VITE_PROJECT_ROOT_PATH)

const DEFAULT_PROJECT_ROOT = '/Root/Content';
export const projectRoot = import.meta.env.VITE_PROJECT_ROOT_PATH || DEFAULT_PROJECT_ROOT;

// Main content paths (configurable via .env)
export const timelinesPath = `${projectRoot}/Timelines`;
export const mediaLibraryPath = `${projectRoot}/MediaLibrary`;
export const timelineEntriesPath = `${projectRoot}/TimelineEntries`;

export const omdbKeyFullPath = `${projectRoot}${import.meta.env.VITE_OMDB_KEY_PATH}`;
export const tmdbKeyFullPath = `${projectRoot}${import.meta.env.VITE_TMDB_KEY_PATH}`;
export const traktKeyFullPath = `${projectRoot}${import.meta.env.VITE_TRAKT_KEY_PATH}`;

// For current environment (e.g. VITE_PROJECT_ROOT_PATH=/Root/Content/timelines):
// timelinesPath = /Root/Content/timelines/Timelines
// mediaLibraryPath = /Root/Content/timelines/MediaLibrary
// timelineEntriesPath = /Root/Content/timelines/TimelineEntries
