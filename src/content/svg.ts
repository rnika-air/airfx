const DANGEROUS = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'link', 'meta', 'base', 'animate', 'animatetransform', 'animatemotion', 'set']);
const EXTERNAL = /url\(\s*['"]?(?!#)|@import|javascript:|expression\(/i;

/**
 * Keeps the drawing and removes anything that can run or load: scripts, event
 * attributes, embedded HTML, external references. Throws if nothing usable is left.
 */
export function sanitizeSvg(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('That file is not a valid SVG.');
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (DANGEROUS.has(child.localName.toLowerCase())) { child.remove(); continue; }
      walk(child);
    }
    for (const a of [...el.attributes]) {
      const name = a.name.toLowerCase(), value = a.value.trim();
      if (name.startsWith('on')) el.removeAttribute(a.name);
      else if ((name === 'href' || name === 'xlink:href') && !value.startsWith('#') && !/^data:image\/(png|jpeg|webp|gif);/i.test(value)) el.removeAttribute(a.name);
      else if ((name === 'style' || name.startsWith('fill') || name.startsWith('stroke') || name === 'filter' || name === 'mask' || name === 'clip-path') && EXTERNAL.test(value)) el.removeAttribute(a.name);
    }
    if (el.localName.toLowerCase() === 'style' && EXTERNAL.test(el.textContent ?? '')) el.remove();
  };
  walk(root);
  // An image needs a size to draw, and many exported icons only have a viewBox.
  const vb = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const num = (v: string | null) => (v && !v.includes('%') ? parseFloat(v) : NaN);
  let w = num(root.getAttribute('width')), h = num(root.getAttribute('height'));
  if (!(w > 0) || !(h > 0)) {
    w = vb && vb[2] > 0 ? vb[2] : 512;
    h = vb && vb[3] > 0 ? vb[3] : 512;
    if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  // Rendered large, so the browser rasterises it from the vector when it is drawn.
  const k = 2048 / Math.max(w, h);
  root.setAttribute('width', String(Math.round(w * k)));
  root.setAttribute('height', String(Math.round(h * k)));
  if (!root.children.length) throw new Error('That SVG has nothing to draw.');
  return new XMLSerializer().serializeToString(root);
}

export const isSvg = (f: File | Blob, name: string) => f.type === 'image/svg+xml' || /\.svg$/i.test(name);
