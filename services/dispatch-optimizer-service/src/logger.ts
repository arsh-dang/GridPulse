/**
 * Same minimal JSON-lines logger as price-ingest-service. One JSON object
 * per line reads cleanly in CloudWatch Logs and can be queried with
 * Logs Insights without any extra setup.
 */
type LogFields = Record<string, unknown>;

function line(level: string, msg: string, fields?: LogFields): string {
  return JSON.stringify({ level, msg, time: new Date().toISOString(), ...fields });
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
