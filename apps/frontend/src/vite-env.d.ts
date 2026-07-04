/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend base URL (defaults to same-origin when unset). */
  readonly VITE_API_URL?: string;
  /** Dev-only: raw Telegram initData when running outside a Telegram client. */
  readonly VITE_DEV_INIT_DATA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
