// Link syntax shared by the plugin and the editor frame. Diagrams hold links
// in two places: a shape's own link (`shape.meta.link`) and links typed into
// its text. Both use Obsidian's syntax: [[wikilinks]], [markdown](links) and
// bare URLs.

export type ParsedLink =
  | { type: 'wiki'; linkpath: string; subpath: string; display: string | null; raw: string }
  | { type: 'markdown'; linkpath: string; subpath: string; display: string; raw: string }
  | { type: 'url'; url: string; display: string | null; raw: string };

// [[path#subpath|alias]], optionally preceded by ! for an embed.
const WIKILINK = /!?\[\[([^[\]|#^]*)((?:[#^][^[\]|]*)?)(?:\|([^[\]]*))?\]\]/g;
// [text](target "title"); targets may be <wrapped in angle brackets>.
const MARKDOWN_LINK = /!?\[([^[\]]*)\]\((<[^>]*>|[^)\s]+)(?:\s+"[^"]*")?\)/g;
const BARE_URL = /\b(?:https?|obsidian):\/\/[^\s<>"'\])]+[^\s<>"'\]).,;:!?]/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function splitSubpath(target: string): { linkpath: string; subpath: string } {
  const at = target.search(/[#^]/);
  return at < 0 ? { linkpath: target, subpath: '' } : { linkpath: target.slice(0, at), subpath: target.slice(at) };
}

function decodeTarget(target: string): string {
  const unwrapped = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
  try {
    return decodeURI(unwrapped);
  } catch {
    return unwrapped;
  }
}

/** Every link in `text`, in order of appearance. */
export function findLinks(text: string): ParsedLink[] {
  if (!text) return [];
  const found: { at: number; end: number; link: ParsedLink }[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    found.push({
      at: m.index,
      end: m.index + m[0].length,
      link: { type: 'wiki', linkpath: m[1].trim(), subpath: m[2] ?? '', display: m[3] ?? null, raw: m[0] },
    });
  }
  for (const m of text.matchAll(MARKDOWN_LINK)) {
    if (found.some((f) => m.index < f.end && m.index + m[0].length > f.at)) continue;
    const target = decodeTarget(m[2]);
    const link: ParsedLink = SCHEME.test(target)
      ? { type: 'url', url: target, display: m[1], raw: m[0] }
      : { type: 'markdown', ...splitSubpath(target), display: m[1], raw: m[0] };
    found.push({ at: m.index, end: m.index + m[0].length, link });
  }
  for (const m of text.matchAll(BARE_URL)) {
    if (found.some((f) => m.index < f.end && m.index + m[0].length > f.at)) continue;
    found.push({ at: m.index, end: m.index + m[0].length, link: { type: 'url', url: m[0], display: null, raw: m[0] } });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.link);
}

/** Interpret the value of a shape's link property. Plain text that is not a
 *  link is read as the name of a note, the way Obsidian reads `[[name]]`. */
export function parseLink(value: string): ParsedLink | null {
  const raw = value.trim();
  if (!raw) return null;
  const [first] = findLinks(raw);
  if (first && first.raw.length === raw.length) return first;
  if (SCHEME.test(raw)) return { type: 'url', url: raw, display: null, raw };
  const { linkpath, subpath } = splitSubpath(raw);
  return { type: 'wiki', linkpath: linkpath.trim(), subpath, display: null, raw: `[[${raw}]]` };
}

/** The link text Obsidian's `openLinkText` expects, or null for a URL. */
export function linkText(link: ParsedLink): string | null {
  return link.type === 'url' ? null : `${link.linkpath}${link.subpath}`;
}

/** Text with link syntax reduced to what a reader sees. */
export function linkLabel(link: ParsedLink): string {
  if (link.type === 'url') return link.display || link.url;
  if (link.display) return link.display;
  const name = link.linkpath.split('/').pop() ?? link.linkpath;
  return (name.replace(/\.md$/i, '') || link.subpath.replace(/^[#^]/, '')).trim();
}

/** Replace the linkpath of every wikilink and internal markdown link in
 *  `text` found in `renames` (matched case-insensitively, as Obsidian
 *  resolves them). Subpaths, aliases and embeds are kept. */
export function rewriteLinks(text: string, renames: ReadonlyMap<string, string>): string {
  if (!text || renames.size === 0) return text;
  const lookup = (linkpath: string) => renames.get(linkpath.trim().toLowerCase());
  let out = text.replace(WIKILINK, (whole, linkpath: string, subpath: string, alias: string | undefined) => {
    const next = lookup(linkpath);
    if (next === undefined) return whole;
    const bang = whole.startsWith('!') ? '!' : '';
    return `${bang}[[${next}${subpath ?? ''}${alias !== undefined ? `|${alias}` : ''}]]`;
  });
  out = out.replace(MARKDOWN_LINK, (whole, label: string, target: string) => {
    const decoded = decodeTarget(target);
    if (SCHEME.test(decoded)) return whole;
    const { linkpath, subpath } = splitSubpath(decoded);
    const next = lookup(linkpath);
    if (next === undefined) return whole;
    const bang = whole.startsWith('!') ? '!' : '';
    // Keep the original's style: <angle brackets> or percent-encoding.
    const encoded = target.startsWith('<')
      ? `<${next}${subpath}>`
      : `${next}${subpath}`.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `${bang}[${label}](${encoded})`;
  });
  return out;
}
