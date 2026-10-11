/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The canonical web URL of the game (origin + path, ending in '/'), used for challenge links when
   * the page itself is not on the web (file: single-file builds, native shells). Committed in
   * `.env`; the GitHub Pages build overrides it with the Pages base URL.
   */
  readonly VITE_SHARE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
