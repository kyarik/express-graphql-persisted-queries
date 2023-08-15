import type { IncomingMessage, ServerResponse } from 'http';

export type Maybe<T> = T | null | undefined;

export interface Request extends IncomingMessage {
  body?: unknown;
}

export type Response = ServerResponse;

export type NextFn = (param?: unknown) => unknown;

export type Middleware = (req: Request, res: Response, next: NextFn) => unknown;

export interface Options {
  /**
   * Maximum size in bytes of the request body.
   */
  maxSize?: number;
}

export type ParsedOptions = Required<Options>;
