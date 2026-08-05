type DatabaseEnvironment = Record<string, string | undefined>;

/** Accept the standard names emitted by Neon and Vercel Postgres integrations. */
export function resolvePostgresUrl(env: DatabaseEnvironment = process.env): string | undefined {
  return (
    env.DATABASE_URL ||
    env.POSTGRES_URL ||
    env.POSTGRES_PRISMA_URL ||
    env.POSTGRES_URL_NON_POOLING ||
    undefined
  );
}
