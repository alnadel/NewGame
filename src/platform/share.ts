// Sharing: Web Share API first, then the clipboard (text) or a download (files) (V1_PLAN §11.4,
// V1_1_PLAN UM7). The caller turns the returned outcome into a toast; nothing here touches the UI.

/**
 * - `shared`: handed to the share sheet. `copied`: the text is on the clipboard.
 * - `saved`: the file was downloaded and the text copied (the copy may have failed).
 * - `cancelled`: the player dismissed the share sheet (show nothing). `failed`: nothing worked.
 */
export type ShareOutcome = 'shared' | 'copied' | 'saved' | 'cancelled' | 'failed';

/** How long a download's object URL lives (the browser has started the download by then). */
const DOWNLOAD_URL_MS = 10_000;

export interface SharePayload {
  title?: string;
  /** Full share text. Include the link in it: some share targets drop a separate `url`. */
  text: string;
}

/** Opens the native share sheet when available, otherwise copies the text ('copied' or 'failed'). */
export async function shareText(payload: SharePayload): Promise<Exclude<ShareOutcome, 'saved'>> {
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

/**
 * Shares a file (the Results postcard) with its text: the native share sheet when it takes files,
 * otherwise a download of the file plus the text on the clipboard ('saved'). Call it synchronously
 * inside the click handler: navigator.share runs before any await, so iOS still sees the tap.
 */
export async function shareFiles(p: { file: File; text: string }): Promise<ShareOutcome> {
  const data: ShareData = { files: [p.file], text: p.text };
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [p.file] }) === true) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // A share target that refused the file: save it instead.
    }
  }
  if (!download(p.file)) return 'failed';
  await copyText(p.text);
  return 'saved';
}

/** Starts a download of `file` through a temporary <a download>. False without a document. */
function download(file: File): boolean {
  if (typeof document === 'undefined' || !document.body || typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_MS);
  return true;
}

interface PolicyHolder {
  permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
  featurePolicy?: { allowsFeature?: (feature: string) => boolean };
}

/**
 * Whether the page's permissions policy lets it write the clipboard. A frame sandboxed without
 * same-origin access (or one whose host withholds clipboard-write) doesn't: asking anyway logs a
 * "Permissions policy violation" on every Share before the legacy copy works.
 */
function clipboardAllowed(): boolean {
  if (typeof document === 'undefined') return true;
  const d = document as unknown as PolicyHolder;
  const policy = d.permissionsPolicy ?? d.featurePolicy;
  if (!policy || typeof policy.allowsFeature !== 'function') return true;
  try {
    return policy.allowsFeature('clipboard-write');
  } catch {
    return true;
  }
}

/** Copies text to the clipboard (async Clipboard API where allowed, then the legacy execCommand path). */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && clipboardAllowed()) {
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
