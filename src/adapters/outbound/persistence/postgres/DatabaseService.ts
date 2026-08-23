import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../../../../main/env';

export class DatabaseService {
  private static instance: DatabaseService;

  private pool: Pool | null = null;
  private database: NodePgDatabase | null = null;

  private constructor() {}

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  public get db(): NodePgDatabase {
    if (!this.database) {
      throw new Error('Database has not been connected yet.');
    }
    return this.database;
  }

  public async connectWithRetry(maxRetries = 5): Promise<NodePgDatabase> {
    const pool = new Pool({
      connectionString: config.databaseUri,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
    });
    const database = drizzle(pool);

    let interval = config.dbConnectionInterval;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await pool.query('SELECT 1');
        console.info(`Connected to the database on attempt ${attempt}.`);
        this.pool = pool;
        this.database = database;
        return database;
      } catch (error) {
        lastError = error;
        console.error(
          `Database connection failed (attempt ${attempt}/${maxRetries}).`
        );

        if (attempt < maxRetries) {
          console.info(`Waiting ${interval}ms before the next attempt.`);
          await new Promise((resolve) => setTimeout(resolve, interval));
          interval *= 2;
        }
      }
    }

    await pool.end().catch(() => undefined);
    throw lastError instanceof Error
      ? lastError
      : new Error('Could not connect to the database.');
  }

  public async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
    this.database = null;
  }
}

export const databaseService = DatabaseService.getInstance();