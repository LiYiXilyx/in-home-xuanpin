import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE_KEY = /(authorization|cookie|password|secret|session|token)/i;

export function createLogger({ logDir, service = 'temu-product-research', consoleOutput = true, now = () => new Date() }) {
  fs.mkdirSync(logDir, { recursive: true });
  const write = (level, message, details = {}) => {
    const timestamp = now().toISOString();
    const record = { timestamp, level, service, message, details: redact(details) };
    const logFile = path.join(logDir, `${timestamp.slice(0, 10)}.jsonl`);
    fs.appendFileSync(logFile, `${JSON.stringify(record)}\n`, 'utf8');
    if (consoleOutput) {
      const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      output(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }
    return record;
  };
  return {
    info: (message, details) => write('info', message, details),
    warn: (message, details) => write('warn', message, details),
    error: (message, details) => write('error', message, details)
  };
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item)]));
}
