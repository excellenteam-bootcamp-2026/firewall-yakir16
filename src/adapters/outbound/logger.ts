import winston from 'winston';
import fs from 'fs';         
import util from 'util';     
import { config } from '../../main/env';

export class Logger {
  private static instance: Logger;
  private winstonLogger!: winston.Logger;

  private constructor() {
    this.initializeWinston();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
      Logger.instance.overrideConsole();
    }
    return Logger.instance;
  }

  private initializeWinston() {
    try {
      const prodFormat = winston.format.combine(
        winston.format.timestamp(),
        winston.format.json() 
      );

      const devFormat = winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message }) => {
          return `[${timestamp}] ${level}: ${message}`;
        }) 
      );

      const isProduction = config.env === 'production';

   
      if (isProduction && !fs.existsSync('logs')) {
        fs.mkdirSync('logs');
      }

      this.winstonLogger = winston.createLogger({
        level: isProduction ? 'info' : 'debug',
        format: isProduction ? prodFormat : devFormat,
        transports: isProduction
          ? [new winston.transports.File({ filename: 'logs/production.log' })]
          : [new winston.transports.Console()],
      });
    } catch (error) {
      process.stdout.write(`[FALLBACK LOG] Failed to initialize Winston: ${error}\n`);
    }
  }

  private overrideConsole() {
    (console as any)._originalLog = console.log;
    (console as any)._originalInfo = console.info;
    (console as any)._originalWarn = console.warn;
    (console as any)._originalError = console.error;
    (console as any)._originalDebug = console.debug; 

    console.log = (...args: any[]) => this.log('info', args);
    console.info = (...args: any[]) => this.log('info', args);
    console.warn = (...args: any[]) => this.log('warn', args);
    console.error = (...args: any[]) => this.log('error', args);
    console.debug = (...args: any[]) => this.log('debug', args); 
  }

  private log(level: string, args: any[]) {
    
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        return util.inspect(arg, { depth: null, colors: false });
      }
      return String(arg);
    }).join(' ');

    if (this.winstonLogger) {
      this.winstonLogger.log({ level, message });
    } else {
      process.stdout.write(`[${level.toUpperCase()}] ${message}\n`);
    }
  }
}

export const logger = Logger.getInstance();