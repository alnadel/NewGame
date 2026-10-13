// Host-provided file saving. Inside the claude.ai artifact viewer a page may not start downloads
// itself; it offers files through the viewer's `downloads` capability, which asks the player to
// confirm. Everywhere else (the web, the PWA, Capacitor) `globalThis.claude` is absent, this stays
// null and sharing falls back to the share sheet or an <a download>.

interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

interface HostDownloads {
  save(request: { filename: string; data: Blob }): Promise<unknown>;
}

/** 'saved' when the player accepted, 'declined' when they said no, 'failed' otherwise. */
export type HostSaveOutcome = 'saved' | 'declined' | 'failed';

let hostSave: ((file: File) => Promise<HostSaveOutcome>) | null = null;

/** Resolves the host's downloads capability once at boot, so a later click can use it at once. */
export function prepareHostDownloads(): void {
  const claude = (globalThis as { claude?: Partial<ClaudeHost> }).claude;
  if (!claude || typeof claude.use !== 'function') return;
  claude.use('downloads').then(
    (ns) => {
      const downloads = ns as Partial<HostDownloads> | null;
      if (!downloads || typeof downloads.save !== 'function') return;
      const save = downloads.save.bind(downloads);
      hostSave = async (file) => {
        try {
          await save({ filename: file.name, data: file });
          return 'saved';
        } catch (err) {
          return (err as { code?: unknown } | null)?.code === 'declined' ? 'declined' : 'failed';
        }
      };
    },
    () => undefined,
  );
}

/** The host's file saver, or null when the page isn't running inside such a host. */
export function hostFileSaver(): ((file: File) => Promise<HostSaveOutcome>) | null {
  return hostSave;
}
