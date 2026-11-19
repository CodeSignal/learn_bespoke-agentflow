import { format } from 'node:util';

/** Supports printf-style placeholders (`%s`, `%d`) in the first argument. */
const line = (level: string, args: unknown[]): string => `[${level}] ${format(...args)}`;

export const logger = {
  info: (...args: unknown[]) => console.log(line('INFO', args)),
  warn: (...args: unknown[]) => console.warn(line('WARN', args)),
  error: (...args: unknown[]) => console.error(line('ERROR', args))
};
