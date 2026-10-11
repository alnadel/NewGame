// Visible failure (frame-loop-dies-on-exception): when the frame loop keeps throwing, or boot itself
// throws, the player gets a plain message and a Reload button instead of a frozen picture. Built
// with inline styles straight into <body>, so it works however broken the UI or the canvas is.

const INK = '#2B2140';
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

function reloadButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = 'Reload';
  b.style.cssText =
    `min-height:48px;min-width:120px;padding:0 24px;border:0;border-radius:24px;background:#FFC23D;color:${INK};` +
    `font:800 18px/48px ${FONT};cursor:pointer;pointer-events:auto`;
  b.addEventListener('click', () => location.reload());
  return b;
}

/** The in-game crash overlay (#crash, role alertdialog). Idempotent: returns the existing one. */
export function showCrashOverlay(text = 'Something went wrong. Your progress is saved.'): HTMLElement {
  const existing = document.getElementById('crash');
  if (existing) return existing;
  const box = document.createElement('div');
  box.id = 'crash';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'crash-text');
  box.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;gap:20px;padding:24px;box-sizing:border-box;background:rgba(43,33,64,0.92);' +
    `color:#FFF8EE;font:700 18px/1.4 ${FONT};text-align:center;pointer-events:auto;touch-action:manipulation`;
  const p = document.createElement('p');
  p.id = 'crash-text';
  p.style.cssText = 'margin:0;max-width:320px';
  p.textContent = text;
  const button = reloadButton();
  box.append(p, button);
  document.body.append(box);
  try {
    button.focus({ preventScroll: true });
  } catch {
    // ignore
  }
  return box;
}

/** Boot failed: the splash says so and offers a Reload (no game, no UI to lean on). */
export function showBootFailure(): void {
  let splash = document.getElementById('boot');
  if (!splash) {
    splash = document.createElement('div');
    splash.id = 'boot';
    document.body.append(splash);
  }
  splash.removeAttribute('aria-hidden');
  splash.setAttribute('role', 'alert');
  splash.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;' +
    `justify-content:center;gap:20px;padding:24px;box-sizing:border-box;background:#34306B;color:#FFE27A;` +
    `font:800 22px/1.3 ${FONT};text-align:center;opacity:1;pointer-events:auto`;
  const p = document.createElement('p');
  p.style.margin = '0';
  p.textContent = "SHADY couldn't start.";
  splash.replaceChildren(p, reloadButton());
}
