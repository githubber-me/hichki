// Reads settings from the environment. See .env.example for what each one means.

// Local settings: .env.local first, then .env. A value already set in the real
// environment (for example by Kubernetes) always wins, and missing files are fine.
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file not there: rely on real environment variables and defaults
  }
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
  dataDir: process.env.DATA_DIR ?? './data',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 10),
  // Break the app on purpose for the NudgeBee demo: "uploads" or "memory". See server/faults.ts.
  break: (process.env.BREAK ?? '').trim(),

  sarvam: {
    apiKey: process.env.SARVAM_API_KEY ?? '',
    baseUrl: 'https://api.sarvam.ai',
    sttModel: process.env.SARVAM_STT_MODEL ?? 'saaras:v4',
    chatModel: process.env.SARVAM_CHAT_MODEL ?? 'sarvam-105b',
    translateModel: process.env.SARVAM_TRANSLATE_MODEL ?? 'sarvam-translate:v1',
  },

  clerk: {
    publishableKey: (process.env.CLERK_PUBLISHABLE_KEY ?? '').trim(),
    secretKey: (process.env.CLERK_SECRET_KEY ?? '').trim(),
  },

  flagsmith: {
    serverKey: process.env.FLAGSMITH_SERVER_SIDE_ENVIRONMENT_KEY ?? '',
    apiUrl: process.env.FLAGSMITH_API_URL || undefined,
    refreshSeconds: Number(process.env.FLAGSMITH_REFRESH_SECONDS ?? 10),
    experiments: process.env.FLAGSMITH_EXPERIMENTS === 'on',
  },
};
