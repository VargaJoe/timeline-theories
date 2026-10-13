import { environment } from './configuration';
// Every service path comes from the same validated public profile.
export const projectRoot = environment.projectRoot;
export const timelinesPath = `${projectRoot}/Timelines`;
export const mediaLibraryPath = `${projectRoot}/MediaLibrary`;
export const timelineEntriesPath = `${projectRoot}/TimelineEntries`;

export const omdbKeyFullPath = `${projectRoot}/(structure)/apikeys/omdb`;
export const tmdbKeyFullPath = `${projectRoot}/(structure)/apikeys/tmdb`;
export const traktKeyFullPath = `${projectRoot}/(structure)/apikeys/trakt`;

// For the default local profile (projectRoot=/Root/Content/timelines):
// timelinesPath = /Root/Content/timelines/Timelines
// mediaLibraryPath = /Root/Content/timelines/MediaLibrary
// timelineEntriesPath = /Root/Content/timelines/TimelineEntries
