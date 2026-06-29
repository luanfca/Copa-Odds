/**
 * Logger centralizado usando Winston.
 * Cria logs com timestamp em pt-BR.
 */

import { createLogger, format, transports } from 'winston';
import path from 'path';

const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] ${level}: ${message}${metaStr}`;
});

export const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
    }),
    new transports.File({
      filename: path.join(process.cwd(), 'logs', 'scraping.log'),
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 5,
    }),
  ],
});
