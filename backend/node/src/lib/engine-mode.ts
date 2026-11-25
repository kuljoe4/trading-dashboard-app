export const ENGINE_MODE = Symbol('ENGINE_MODE');

export type EngineMode = 'live' | 'paper';

export function getEngineMode(value = process.env.TRADING_ENGINE_MODE): EngineMode | undefined {
  if (!value) return undefined;
  if (value === 'live' || value === 'paper') return value;
  throw new Error('TRADING_ENGINE_MODE must be live or paper.');
}

export function getEngineDatabaseUrl(mode: EngineMode | undefined, liveUrl?: string, paperUrl?: string) {
  if (mode !== 'paper') return liveUrl;
  if (!paperUrl || !liveUrl) {
    throw new Error('A dedicated Paper engine requires PAPER_DATABASE_URL and DATABASE_URL (the Live database reference).');
  }
  const databaseName = (value: string) => decodeURIComponent(new URL(value).pathname);
  if (databaseName(paperUrl) === '/' || !databaseName(paperUrl) || databaseName(paperUrl) === databaseName(liveUrl)) {
    throw new Error('Paper and Live engines must use different PostgreSQL database names.');
  }
  return paperUrl;
}
