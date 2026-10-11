// Sharing text: Web Share API first, then the clipboard (V1_PLAN §11.4). The caller turns the
// returned outcome into a toast; nothing here touches the UI.

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface SharePayload {
  title?: string;
  /** Full share text. Include the link in it: some share targets drop a separate `url`. */
  text: string;
}

/**
 * Opens the native share sheet when available, otherwise copies the text.
 * - `shared`: handed to the share sheet.
 * - `copied`: on the clipboard (show "Copied!").
 * - `cancelled`: the player dismissed the share sheet (show nothing).
 * - `failed`: neither worked (show a manual-copy hint).
 */
export async function shareText(payload: SharePayload): Promise<ShareOutcome> {
  const data: ShareData = payload.title ? { title: payload.title, text: payload.text } : { text: payload.text };
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const allowed = typeof navigator.canShare !== 'function' || navigator.canShare(data);
    if (allowed) {
      try {
        await navigator.share(data);
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
        // NotAllowedError (no user activation) or a broken share target: fall through to the clipboard.
      }
    }
  }
  return (await copyText(payload.text)) ? 'copied' : 'failed';
}

/** Copies text to the clipboard (async Clipboard API, then the legacy execCommand path). */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or insecure context: try the legacy path.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(area);
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    // Deprecated but still the only synchronous fallback on older iOS WebViews.
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  previous?.focus({ preventScroll: true });
  return ok;
}
