import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

test('document scripts remain same-origin and the local scroll polyfill keeps its exact verified version and MIT license', () => {
  const html = fs.readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]);
  assert(sources.includes('/vendor/delayed-scroll-restoration-polyfill/0.1.1/index.js'));
  for (const source of sources) {
    const url = new URL(source, 'https://document.fixture.invalid');
    assert.equal(url.origin, 'https://document.fixture.invalid', 'Document scripts must not depend on a third-party CDN.');
  }
  const root = new URL('../client/public/vendor/delayed-scroll-restoration-polyfill/0.1.1/', import.meta.url);
  const source = JSON.parse(fs.readFileSync(new URL('SOURCE.json', root), 'utf8'));
  assert.equal(source.package, 'delayed-scroll-restoration-polyfill'); assert.equal(source.version, '0.1.1'); assert.equal(source.license, 'MIT');
  assert.equal(source.scriptSha256, '59ab8dba4f7253a01a022909c3889c5254eb371b6e7b258c1d35502b8fb1a349');
  for (const [file, expected] of [[source.scriptFile, source.scriptSha256], [source.licenseFile, source.licenseSha256]]) {
    assert.equal(createHash('sha256').update(fs.readFileSync(new URL(file, root))).digest('hex'), expected);
  }
  assert(fs.readFileSync(new URL(source.licenseFile, root), 'utf8').includes('Permission is hereby granted, free of charge'));
});
