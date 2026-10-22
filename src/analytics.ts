// Vercel Web Analytics, on the deployed site only (not in dev or headless renders). Vercel hands the
// project's script paths to the builds it runs, as the Vite integrations read them; without them
// (a build elsewhere) the script falls back to its default path.

import { inject } from '@vercel/analytics'

export function startAnalytics() {
  if (!import.meta.env.PROD) return
  inject(
    {
      mode: 'production',
      framework: 'vite',
      basePath: import.meta.env.VITE_VERCEL_OBSERVABILITY_BASEPATH
    },
    import.meta.env.VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG
  )
}
