// The Markdown diagram format (`*.vellum.md`).
//
//   ---
//   vellum-plugin: parsed
//   (any other properties)
//   ---
//   Notes written beside the diagram, kept as they are.
//
//   # Vellum Data
//   %% Generated from the diagram below. %%
//
//   ## Text
//   - API Gateway ^shape-1a2b3c4d
//   - See [[Runbook]] for failover ^shape-5e6f7a8b
//
//   ## Links
//   - [[Runbook]] ^shape-5e6f7a8b-link
//
//   %%
//   ## Diagram
//   ```vellum
//   (the same YAML a .vellum file holds)
//   ```
//   %%
//
// The Text and Links sections exist for Obsidian: search finds the text,
// links show up in backlinks and the graph, and Obsidian rewrites them when
// a note is renamed. They are regenerated on every save. The diagram itself
// sits in a comment so reading view shows the notes, not the YAML.

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { DiagramSnapshot, IndexSections } from '../shared/protocol';

export const FRONTMATTER_KEY = 'vellum-plugin';
export const DATA_HEADING = '# Vellum Data';
export const MARKDOWN_SUFFIX = '.vellum.md';
const PLAIN_INFO = 'vellum';
const COMPRESSED_INFO = 'vellum-compressed';
const LINK_SUFFIX = '-link';

export interface MarkdownDiagram {
  /** Frontmatter lines between the `---` fences, or null when absent. */
  frontmatter: string | null;
  /** Everything the user wrote outside the generated section. */
  body: string;
  yaml: string | null;
  compressed: boolean;
  sections: IndexSections;
}

interface Fence {
  char: '`' | '~';
  length: number;
  info: string;
}

function openingFence(line: string): Fence | null {
  const m = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/.exec(line);
  if (!m) return null;
  return { char: m[1][0] as '`' | '~', length: m[1].length, info: m[2] };
}

function closesFence(line: string, fence: Fence): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return !!m && m[1][0] === fence.char && m[1].length >= fence.length;
}

function splitFrontmatter(text: string): { frontmatter: string | null; rest: string } {
  const normalised = text.replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalised);
  if (!m) {
    const empty = /^---\r?\n---[ \t]*(?:\r?\n|$)/.exec(normalised);
    if (empty) return { frontmatter: '', rest: normalised.slice(empty[0].length) };
    return { frontmatter: null, rest: normalised };
  }
  return { frontmatter: m[1], rest: normalised.slice(m[0].length) };
}

function decodeCompressed(body: string): string {
  const base64 = body.replace(/\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return strFromU8(inflateSync(bytes));
}

function encodeCompressed(yaml: string): string {
  const bytes = deflateSync(strToU8(yaml), { level: 9 });
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/.{1,120}/g, '$&\n').trimEnd();
}

/** Read a Markdown diagram. Never throws: a file without a diagram block
 *  reads as notes with no diagram yet. */
export function parseMarkdownDiagram(text: string): MarkdownDiagram {
  const { frontmatter, rest } = splitFrontmatter(text);
  const lines = rest.split(/\r?\n/);
  let dataStart = -1;
  let fence: Fence | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (fence) {
      if (closesFence(lines[i], fence)) fence = null;
      continue;
    }
    fence = openingFence(lines[i]);
    if (!fence && lines[i].trimEnd() === DATA_HEADING) dataStart = i;
  }

  const sections: IndexSections = { text: {}, links: {} };
  if (dataStart < 0) return { frontmatter, body: rest, yaml: null, compressed: false, sections };

  let section: 'text' | 'links' | null = null;
  let yaml: string | null = null;
  let compressed = false;
  for (let i = dataStart + 1; i < lines.length; i++) {
    const line = lines[i];
    const open = openingFence(line);
    if (open) {
      const content: string[] = [];
      let j = i + 1;
      while (j < lines.length && !closesFence(lines[j], open)) content.push(lines[j++]);
      if (open.info === PLAIN_INFO || open.info === COMPRESSED_INFO) {
        yaml = content.join('\n');
        compressed = open.info === COMPRESSED_INFO;
      }
      i = j;
      continue;
    }
    if (/^##\s+Text\s*$/.test(line)) section = 'text';
    else if (/^##\s+Links\s*$/.test(line)) section = 'links';
    else if (/^#{1,2}\s/.test(line)) section = null;
    else if (section) {
      const m = /^- (.*) \^([A-Za-z0-9-]+)\s*$/.exec(line);
      if (!m) continue;
      if (section === 'text') sections.text[m[2]] = m[1];
      else if (m[2].endsWith(LINK_SUFFIX)) sections.links[m[2].slice(0, -LINK_SUFFIX.length)] = m[1].trim();
    }
  }

  if (yaml !== null && compressed) {
    try {
      yaml = decodeCompressed(yaml);
    } catch {
      yaml = null;
    }
  }
  const body = lines.slice(0, dataStart).join('\n');
  return { frontmatter, body, yaml, compressed, sections };
}

/** Escape what would turn an index line into another kind of Markdown
 *  block, and comment markers, without touching links or tags. */
export function escapeEntry(text: string): string {
  let out = text.replace(/\s+/g, ' ').trim().replace(/%%/g, '%\\%').replace(/</g, '\\<');
  if (/^(?:#|>|[-+*=|]|\d+[.)]|\[[ xX]\]|`{3}|~{3})/.test(out)) out = `\\${out}`;
  return out;
}

function withFrontmatterKey(frontmatter: string | null): string {
  if (frontmatter === null || !frontmatter.trim()) return `${FRONTMATTER_KEY}: parsed`;
  if (new RegExp(`^${FRONTMATTER_KEY}\\s*:`, 'm').test(frontmatter)) return frontmatter;
  return `${FRONTMATTER_KEY}: parsed\n${frontmatter}`;
}

function fenceFor(content: string): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(longest + 1);
}

export function composeMarkdownDiagram(
  page: Pick<MarkdownDiagram, 'frontmatter' | 'body'>,
  snapshot: Pick<DiagramSnapshot, 'yaml' | 'text' | 'links' | 'extra'>,
  options: { compress: boolean },
): string {
  const out: string[] = ['---', withFrontmatterKey(page.frontmatter), '---'];
  const body = page.body.replace(/\s+$/, '');
  if (body.trim()) out.push(body.replace(/^\n+/, ''), '');
  else out.push('');
  out.push(DATA_HEADING, '%% Generated from the diagram below. Open the file as a diagram to edit it. %%', '');

  const text = [
    ...snapshot.text.map((entry) => `- ${escapeEntry(entry.text)} ^${entry.block}`),
    ...[...new Set(snapshot.extra)].filter(Boolean).map((entry) => `- ${escapeEntry(entry)}`),
  ];
  if (text.length) out.push('## Text', ...text, '');
  if (snapshot.links.length) {
    out.push('## Links', ...snapshot.links.map((entry) => `- ${entry.link.replace(/\s+/g, ' ')} ^${entry.block}${LINK_SUFFIX}`), '');
  }

  const content = options.compress ? encodeCompressed(snapshot.yaml) : snapshot.yaml.replace(/\s+$/, '');
  const fence = fenceFor(content);
  out.push('%%', '## Diagram', `${fence}${options.compress ? COMPRESSED_INFO : PLAIN_INFO}`, content, fence, '%%', '');
  return out.join('\n');
}

/** Whether text looks like a Markdown diagram, for files the metadata
 *  cache has not indexed yet. */
export function hasDiagramFrontmatter(text: string): boolean {
  const { frontmatter } = splitFrontmatter(text);
  return frontmatter !== null && new RegExp(`^${FRONTMATTER_KEY}\\s*:`, 'm').test(frontmatter);
}
