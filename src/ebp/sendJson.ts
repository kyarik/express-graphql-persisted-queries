import { CONTENT_TYPE_JSON } from './constants';
import type { Response } from './types';

export function sendJson(res: Response, payload: unknown): void {
  const json = JSON.stringify(payload);
  const buffer = Buffer.from(json, 'utf8');

  res.setHeader('Content-Type', `${CONTENT_TYPE_JSON}; charset=utf-8`);
  res.setHeader('Content-Length', String(buffer.length));
  res.end(buffer);
}
