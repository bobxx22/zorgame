/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ZORIA_SERVER?: string
  readonly VITE_ZORIA_API_URL?: string
  readonly VITE_ZORIA_PROD_KEY_FINGERPRINT?: string
  readonly VITE_ZORIA_STAND_KEY_FINGERPRINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
