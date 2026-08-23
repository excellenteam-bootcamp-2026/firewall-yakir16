import winston from 'winston';
import util from 'util';
import { config } from '../../main/env';

const IS_TEST = process.env.NODE_ENV === 'test';

export class Logger {
  private static instance: Logger;
  private winstonLogger!: winston.Logger;

  private constructor() {
    this.initializeWinston();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
      if (!IS_TEST) {
        Logger.instance.overrideConsole();
      }
    }
    return Logger.instance;
  }

  private initializeWinston(): void {
    try {
      const isProduction = config.env === 'production';

      const prodFormat = winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      );

      const devFormat = winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(
          ({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`
        )
      );

      const transports: winston.transport[] = [];

      if (isProduction) {
        transports.push(
          new winston.transports.File({
            filename: 'logs/production.log',
            maxsize: 10_000_000,
            maxFiles: 5,
          })
        );
        transports.push(new winston.transports.Console());
      } else {
        transports.push(new winston.transports.Console());
      }

      this.winstonLogger = winston.createLogger({
        level: isProduction ? 'info' : 'debug',
        format: isProduction ? prodFormat : devFormat,
        transports,
        silent: IS_TEST,
      });
    } catch (error) {
      process.stdout.write(
        `[FALLBACK LOG] Failed to initialize Winston: ${error}\n`
      );
    }
  }

  private overrideConsole(): void {
    console.log = (...args: unknown[]) => this.log('info', args);
    console.info = (...args: unknown[]) => this.log('info', args);
    console.warn = (...args: unknown[]) => this.log('warn', args);
    console.error = (...args: unknown[]) => this.log('error', args);
    console.debug = (...args: unknown[]) => this.log('debug', args);
  }

  private log(level: string, args: unknown[]): void {
    const message = args
      .map((arg) =>
        typeof arg === 'object' && arg !== null
          ? util.inspect(arg, { depth: null, colors: false })
          : String(arg)
      )
      .join(' ');

    if (this.winstonLogger) {
      this.winstonLogger.log({ level, message });
    } else {
      process.stdout.write(`[${level.toUpperCase()}] ${message}\n`);
    }
  }
}

export const logger = Logger.getInstance();
