// Tiny DOM helpers. Dynamic text always goes through textContent/append (never innerHTML), so names
// coming from the sim or a pasted code can't inject markup. Only static, in-repo SVG uses markup.

export type AttrValue = string | number | boolean | null | undefined;
export type Child = Node | string | null | undefined | false;

/** Creates an element. `false`/`null`/`undefined` attributes and children are skipped; `true` sets an empty attribute. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, AttrValue> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = String(value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, ...children);
  return el;
}

export function append(parent: Element, ...children: Child[]): void {
  for (const c of children) if (c !== null && c !== undefined && c !== false) parent.append(c);
}

/** Replaces all children. */
export function setChildren(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, ...children);
}

const template = (): HTMLTemplateElement => document.createElement('template');

/** Parses trusted, static SVG markup (icons and art defined in this repo). */
export function svgFromMarkup(markup: string): SVGSVGElement {
  const t = template();
  t.innerHTML = markup.trim();
  const node = t.content.firstElementChild;
  if (!(node instanceof SVGSVGElement)) throw new Error('svgFromMarkup: markup is not an <svg>');
  return node;
}

/** Toggles a boolean attribute such as `disabled` or `hidden`. */
export function setFlag(el: Element, name: string, on: boolean): void {
  if (on) el.setAttribute(name, '');
  else el.removeAttribute(name);
}

/** True for elements that handle Enter/Space themselves. */
export function isInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.closest('button, a[href], input, textarea, select, [role="switch"], [role="radio"], [role="tab"]') !== null ||
      target.isContentEditable)
  );
}
