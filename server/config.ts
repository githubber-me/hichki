// Reads settings from the environment. See .env.example for what each one means.

try {
  process.loadEnvFile(); // loads .env when it exists; fine if it doesn't
} catch {
  // no .env file: rely on real environment variables and defaults
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
  dataDir: process.env.DATA_DIR ?? './data',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 10),

  sarvam: {
    apiKey: process.env.SARVAM_API_KEY ?? '',
    baseUrl: 'https://api.sarvam.ai',
    sttModel: process.env.SARVAM_STT_MODEL ?? 'saaras:v4',
    chatModel: process.env.SARVAM_CHAT_MODEL ?? 'sarvam-105b',
    translateModel: process.env.SARVAM_TRANSLATE_MODEL ?? 'sarvam-translate:v1',
  },

  flagsmith: {
    serverKey: process.env.FLAGSMITH_SERVER_SIDE_ENVIRONMENT_KEY ?? '',
    apiUrl: process.env.FLAGSMITH_API_URL || undefined,
    refreshSeconds: Number(process.env.FLAGSMITH_REFRESH_SECONDS ?? 10),
    experiments: process.env.FLAGSMITH_EXPERIMENTS === 'on',
  },
};
