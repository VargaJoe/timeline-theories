import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from '../client/node_modules/typescript/lib/typescript.js';

// Exercise the real cover consumer and URL resolver. Only repository I/O is
// replaced; the native snapshot overlay returns expanded references as arrays.
const compile = (file, prefix) => {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')
    .replace(/^import .* from .*;\r?$/gm, '');
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(prefix + '\n' + source,
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
};
const repositoryUrl = 'https://repo.test';
let rows;
globalThis.__timelineCoverRepository = {
  async loadCollection({ path }) {
    assert.equal(path, '/Root/Content/timelines/Timelines/example');
    return { d: { results: structuredClone(rows) } };
  },
};
const mediaModule = compile('client/services/mediaLibraryService.ts',
  `const repositoryUrl=${JSON.stringify(repositoryUrl)}; const mediaLibraryPath='/Root/Content/timelines/MediaLibrary';`);
const timelineModule = compile('client/services/timelineService.ts',
  `import {MediaLibraryService} from ${JSON.stringify(mediaModule)}; const repository=globalThis.__timelineCoverRepository;`);
const { getTimelineMediaCovers } = await import(timelineModule);
const cover = { Id: 21, CoverImageBin: { __mediaresource: {
  media_src: '/binaryhandler.ashx?nodeid=21&propertyname=CoverImageBin&checksum=123', content_type: 'image/jpeg',
} } };
const fallback = { Id: 22, CoverImageUrl: 'https://covers.test/poster.jpg' };
const expected = [repositoryUrl + cover.CoverImageBin.__mediaresource.media_src, fallback.CoverImageUrl];

for (const [shape, reference] of [['native snapshot arrays', media => [media]], ['legacy OData objects', media => media]]) {
  test('timeline montage resolves binary and URL covers from ' + shape, async () => {
    rows = [cover, fallback].map((media, index) => ({ Id: index + 1, MediaItem: reference(media) }));
    assert.deepEqual(await getTimelineMediaCovers('/Root/Content/timelines/Timelines/example'), expected);
  });
}

test('missing and empty media references do not hide the next readable cover', async () => {
  rows = [{ Id: 1 }, { Id: 2, MediaItem: null }, { Id: 3, MediaItem: [] }, { Id: 4, MediaItem: [cover] }];
  assert.deepEqual(await getTimelineMediaCovers('/Root/Content/timelines/Timelines/example'), [expected[0]]);
});
