// Variables Vercel sets for the builds it runs (src/analytics.ts)
interface ImportMetaEnv {
  readonly VITE_VERCEL_OBSERVABILITY_BASEPATH?: string
  readonly VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG?: string
}
