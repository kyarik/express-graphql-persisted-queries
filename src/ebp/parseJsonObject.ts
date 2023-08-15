export function parseJsonObject(json: string): Record<string, unknown> {
  if (!/^[ \t\n\r]*{/.test(json)) {
    throw new Error('Not a JSON object.');
  }

  return JSON.parse(json) as Record<string, unknown>;
}
