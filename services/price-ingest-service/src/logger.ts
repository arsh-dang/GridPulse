/**
 * Minimal structured logger. Not pino/winston on purpose — this service
 * has no log-aggregation requirement yet, and a real logger can replace
 * this without touching call sites since the shape (info/warn/error) is
 * the common subset any of them would offer.
 */
type LogFields = Record<string, unknown>;

function line(level: string, msg: string, fields?: LogFields): string {
  const base = { level, msg, time: new Date().toISOString(), ...fields };
  return JSON.stringify(base);
}

export const logger = {
  info(msg: string, fields?: LogFields): void {
    console.log(line("info", msg, fields));
  },
  warn(msg: string, fields?: LogFields): void {
    console.warn(line("warn", msg, fields));
  },
  error(msg: string, fields?: LogFields): void {
    console.error(line("error", msg, fields));
  },
};
