/**
 * Central logger. Use a tagged logger per concern:
 *   import { log } from './logger';
 *   const l = log.withTag('llm');
 *   l.info('streaming started');
 *
 * Swap the consola import for a pino-based one later if we want
 * structured JSON output in production — call sites won't change.
 */

import { consola } from 'consola';

export const log = consola;
export type Logger = typeof consola;
