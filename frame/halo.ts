// The glow on linked shapes: three stacked drop shadows in blue, purple and
// green that trace the shape's silhouette, with the colours cycling.
//
// It is an SVG <filter> per shape rather than CSS drop-shadow(): WebKit
// (Obsidian on iOS) does not paint CSS filter functions on SVG content.
// Each filter's region is the shape's box in its own user space, grown by
// the glow's reach, so it follows pan, zoom and rotation without being
// measured again. The filters live in a hidden <svg> outside the canvas,
// and one constructed stylesheet points each glowing shape at its filter,
// so nothing core renders is modified.

export type GlowKind = 'hover' | 'active' | 'pulse';

const COLOURS = ['#50b4ff', '#a064ff', '#5ae6a0'] as const;
const BLURS: Record<GlowKind, readonly [number, number, number]> = {
  hover: [1, 3, 7],
  active: [1.5, 5, 10],
  pulse: [2, 6, 12],
};
const PRECEDENCE: GlowKind[] = ['pulse', 'active', 'hover'];
const SVG_NS = 'http://www.w3.org/2000/svg';

const sheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

let defs: SVGDefsElement | null = null;
function filterDefs(): SVGDefsElement {
  if (defs?.isConnected) return defs;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.classList.add('vellum-glow-defs');
  defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

const glows: Record<GlowKind, Set<string>> = { hover: new Set(), active: new Set(), pulse: new Set() };
let clickable = new Set<string>();
const filterIds = new Map<string, string>();
let nextId = 0;

const selectorFor = (shapeId: string) => `[data-shape-id="${CSS.escape(shapeId)}"]`;

function measure(shapeId: string): DOMRect | null {
  for (const el of document.querySelectorAll<SVGGraphicsElement>(selectorFor(shapeId))) {
    if (!el.closest('[data-vellum-canvas]')) continue;
    try {
      const box = el.getBBox();
      if (box.width > 0 || box.height > 0) return box;
    } catch {
      // Not rendered (display: none, detached).
    }
  }
  return null;
}

function buildFilter(kind: GlowKind, shapeId: string): string | null {
  const box = measure(shapeId);
  if (!box) return null;
  const key = `${kind}:${shapeId}`;
  let id = filterIds.get(key);
  let filter = id ? (document.getElementById(id) as SVGFilterElement | null) : null;
  if (!filter) {
    id = `vellum-glow-${++nextId}`;
    filterIds.set(key, id);
    filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = id;
    filter.dataset.vellumGlow = kind;
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    BLURS[kind].forEach((blur, i) => {
      const layer = document.createElementNS(SVG_NS, 'feDropShadow');
      if (i > 0) layer.setAttribute('in', `glow${i - 1}`);
      layer.setAttribute('result', `glow${i}`);
      layer.setAttribute('dx', '0');
      layer.setAttribute('dy', '0');
      layer.setAttribute('stdDeviation', String(blur));
      layer.setAttribute('flood-color', COLOURS[i]);
      layer.setAttribute('flood-opacity', '1');
      filter!.appendChild(layer);
    });
    filterDefs().appendChild(filter);
  }
  // A Gaussian is spent by three standard deviations, and each layer blurs
  // the result of the one before.
  const reach = 3 * BLURS[kind].reduce((sum, b) => sum + b, 0);
  filter.setAttribute('x', String(box.x - reach));
  filter.setAttribute('y', String(box.y - reach));
  filter.setAttribute('width', String(box.width + 2 * reach));
  filter.setAttribute('height', String(box.height + 2 * reach));
  return id!;
}

function render() {
  const rules: string[] = [];
  if (clickable.size) {
    // The whole box takes the pointer, so hollow outlines and icons are
    // clickable inside, and the cursor says so.
    const selectors = [...clickable].map(selectorFor).join(',');
    rules.push(`${selectors}{cursor:pointer;pointer-events:bounding-box}`);
  }
  const done = new Set<string>();
  for (const kind of PRECEDENCE) {
    for (const shapeId of glows[kind]) {
      if (done.has(shapeId)) continue;
      done.add(shapeId);
      const id = buildFilter(kind, shapeId);
      if (!id) continue;
      const selector = selectorFor(shapeId);
      rules.push(`${selector}{filter:url(#${id})}`);
      // Rack modules and interfaces are transparent hit areas over the
      // device face; give the glow an outline to trace.
      rules.push(`${selector}[data-rack-target]{stroke:${COLOURS[0]};stroke-width:2px;vector-effect:non-scaling-stroke}`);
    }
  }
  for (const [key, id] of filterIds) {
    const [kind, ...rest] = key.split(':');
    if (glows[kind as GlowKind].has(rest.join(':'))) continue;
    document.getElementById(id)?.remove();
    filterIds.delete(key);
  }
  sheet.replaceSync(rules.join('\n'));
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    render();
  });
}

export function setGlow(kind: GlowKind, shapeIds: Iterable<string>) {
  glows[kind] = new Set(shapeIds);
  schedule();
}

export function setClickable(shapeIds: Iterable<string>) {
  clickable = new Set(shapeIds);
  schedule();
}

/** Measure again after the canvas redrew shapes with new geometry. */
export function refreshGlows() {
  if (glows.hover.size || glows.active.size || glows.pulse.size) schedule();
}
