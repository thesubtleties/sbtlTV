import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const DEFAULT_LEVEL: LogLevel = 'info';
const levelName = (process.env.SBTLTV_LOG_LEVEL || DEFAULT_LEVEL).toLowerCase() as LogLevel;
const currentLevel = LEVELS[levelName] ?? LEVELS[DEFAULT_LEVEL];

let logStream: fs.WriteStream | null = null;

const ensureLogStream = (): fs.WriteStream | null => {
  if (logStream) return logStream;
  const filePath = process.env.SBTLTV_LOG_FILE;
  if (!filePath) return null;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  logStream = fs.createWriteStream(filePath, { flags: 'a' });
  return logStream;
};

const formatArg = (arg: unknown): string => {
  if (arg === null || arg === undefined) return String(arg);
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (typeof arg === 'bigint') return `${arg.toString()}n`;
  if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ''}`.trim();
  if (typeof arg === 'object' && arg && (arg as { __error?: boolean }).__error) {
    const err = arg as { message?: string; stack?: string };
    return `${err.message ?? 'Error'}\n${err.stack ?? ''}`.trim();
  }
  return util.inspect(arg, { depth: 4, maxArrayLength: 50, breakLength: 120 });
};

const writeLine = (line: string, isError: boolean): void => {
  const output = `${line}\n`;
  if (isError) process.stderr.write(output);
  else process.stdout.write(output);
  const stream = ensureLogStream();
  if (stream) stream.write(output);
};

export const log = (level: LogLevel, tag: string, ...args: unknown[]): void => {
  if (LEVELS[level] > currentLevel) return;
  const ts = new Date().toISOString();
  const msg = args.map(formatArg).join(' ');
  writeLine(`${ts} [${level}] [${tag}] ${msg}`, level === 'error');
};

export const patchConsole = (tag: string): void => {
  const original = { ...console };
  console.log = (...args: unknown[]) => log('info', tag, ...args);
  console.info = (...args: unknown[]) => log('info', tag, ...args);
  console.warn = (...args: unknown[]) => log('warn', tag, ...args);
  console.error = (...args: unknown[]) => log('error', tag, ...args);
  console.debug = (...args: unknown[]) => log('debug', tag, ...args);
  console.trace = (...args: unknown[]) => {
    log('trace', tag, new Error().stack ?? 'trace');
    original.trace(...args);
  };
};

export const initLogging = (tag: string): void => {
  ensureLogStream();
  patchConsole(tag);
};
