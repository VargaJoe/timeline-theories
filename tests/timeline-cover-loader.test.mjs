import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from '../client/node_modules/typescript/lib/typescript.js';

const source = fs.readFileSync(new URL('../client/services/timelineCoverLoader.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createTimelineCoverLoader } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const timelines = [1, 2, 3, 4].map(id => ({ id: String(id), name: 'timeline-' + id }));

test('covers publish progressively with two workers and deduplicate Load More additions', async () => {
  const waiting = new Map(), started = [], published = [];
  const loader = createTimelineCoverLoader(timeline => new Promise(resolve => {
    started.push(timeline.id); waiting.set(timeline.id, resolve);
  }), (timeline, covers) => published.push([timeline.id, covers]));
  loader.enqueue(timelines.slice(0, 3));
  loader.enqueue(timelines);
  await tick();
  assert.deepEqual(started, ['1', '2']);
  waiting.get('2')(['second.jpg']); await tick();
  assert.deepEqual(published, [['2', ['second.jpg']]]);
  assert.deepEqual(started, ['1', '2', '3']);
  waiting.get('3')([]); await tick();
  assert.deepEqual(started, ['1', '2', '3', '4']);
  waiting.get('1')(['first.jpg']); waiting.get('4')(['fourth.jpg']); await tick();
  assert.equal(published.length, 4);
  loader.dispose();
});

test('changing view aborts active work, discards late results and does not start queued cards', async () => {
  const waiting = [], signals = [], published = [];
  const loader = createTimelineCoverLoader((_timeline, signal) => new Promise(resolve => {
    signals.push(signal); waiting.push(resolve);
  }), (...args) => published.push(args));
  loader.enqueue(timelines); await tick();
  loader.dispose();
  assert(signals.every(signal => signal.aborted));
  waiting.forEach(resolve => resolve(['old-identity.jpg'])); await tick();
  loader.enqueue(timelines); await tick();
  assert.equal(waiting.length, 2);
  assert.deepEqual(published, []);
});

test('a failed card publishes its empty fallback without preventing later cards', async () => {
  const published = [];
  const loader = createTimelineCoverLoader(async timeline => {
    if (timeline.id === '1') throw new Error('unavailable');
    return ['cover-' + timeline.id];
  }, (timeline, covers) => published.push([timeline.id, covers]));
  loader.enqueue(timelines); await tick();
  assert.equal(published.length, 4);
  assert.deepEqual(published.find(([id]) => id === '1'), ['1', []]);
  loader.dispose();
});
