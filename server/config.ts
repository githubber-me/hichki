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
};
