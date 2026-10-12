// Native shell detection (archive/TECH_SPEC §18). Platform adapters switch on this; the web build has no
// Capacitor global, so everything takes the web path until native projects exist.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
}

/** True inside a Capacitor iOS/Android shell. */
export function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  try {
    return typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform();
  } catch {
    return false;
  }
}
