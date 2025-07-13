/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENSENET_REPO_URL: string
  readonly VITE_OIDC_CLIENT_ID: string
  readonly VITE_OIDC_AUTHORITY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
