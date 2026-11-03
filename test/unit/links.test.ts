import assert from 'node:assert/strict';
import test from 'node:test';
import { findLinks, linkLabel, linkText, parseLink, rewriteLinks } from '../../shared/links';

test('finds wikilinks, markdown links and bare URLs in order', () => {
  const links = findLinks('See [[Runbook#Restore|the runbook]], [docs](Guides/Setup.md) and https://example.com/a.');
  assert.deepEqual(links.map((l) => l.type), ['wiki', 'markdown', 'url']);
  const [wiki, md, url] = links;
  assert.equal(wiki.type === 'wiki' && wiki.linkpath, 'Runbook');
  assert.equal(wiki.type === 'wiki' && wiki.subpath, '#Restore');
  assert.equal(wiki.type === 'wiki' && wiki.display, 'the runbook');
  assert.equal(md.type === 'markdown' && md.linkpath, 'Guides/Setup.md');
  assert.equal(url.type === 'url' && url.url, 'https://example.com/a');
});

test('a URL inside a markdown link is not found twice', () => {
  const links = findLinks('[site](https://example.com/path)');
  assert.equal(links.length, 1);
  assert.equal(links[0].type, 'url');
});

test('a link property may be plain text naming a note', () => {
  const link = parseLink('Runbook#Restore');
  assert.equal(link?.type, 'wiki');
  assert.equal(link && linkText(link), 'Runbook#Restore');
  assert.equal(parseLink('https://example.com')?.type, 'url');
  assert.equal(parseLink('  '), null);
  assert.equal(parseLink('[[A|B]]')?.raw, '[[A|B]]');
});

test('labels read as the reader sees them', () => {
  assert.equal(linkLabel(parseLink('[[Folder/Note.md]]')!), 'Note');
  assert.equal(linkLabel(parseLink('[[Note|Alias]]')!), 'Alias');
  assert.equal(linkLabel(parseLink('https://example.com')!), 'https://example.com');
});

test('rewrites linkpaths case-insensitively and keeps subpaths, aliases and embeds', () => {
  const renames = new Map([['old note', 'New note']]);
  assert.equal(rewriteLinks('[[Old Note#H|alias]] and ![[old note]]', renames), '[[New note#H|alias]] and ![[New note]]');
  assert.equal(rewriteLinks('[x](Old%20Note#H)', renames), '[x](New%20note#H)');
  assert.equal(rewriteLinks('[x](<Old Note.md>)', new Map([['old note.md', 'New note.md']])), '[x](<New note.md>)');
  assert.equal(rewriteLinks('[x](https://old.note)', renames), '[x](https://old.note)');
  assert.equal(rewriteLinks('[[Other]]', renames), '[[Other]]');
});
