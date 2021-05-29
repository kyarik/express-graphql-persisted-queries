import type { IncomingMessage, ServerResponse } from 'http';

export type Maybe<T> = T | null | undefined;

export type PromiseOrValue<T> = Promise<T> | T;

export type AnyFunction = (...args: unknown[]) => unknown;

export interface Request extends IncomingMessage {
  body?: unknown;
  url: string;
}

export type Response = ServerResponse;

export type NextFn = (param?: unknown) => void;

export type Middleware = (req: Request, res: Response, next: NextFn) => void;

export type QueryMapFn = (queryId: string) => PromiseOrValue<Maybe<string>>;

export type LooseQueryMapFn = (queryId: string) => unknown;

export type QueryMap = QueryMapFn | Record<string, Maybe<string>>;

export type LooseQueryMap = LooseQueryMapFn | Record<string, unknown>;

export interface OptionsData {
  /**
   * The key in the search params or request body that specifies the ID of the
   * persisted query.
   */
  queryIdKey?: string;

  /**
   * Either an object mapping query IDs to query text or a function that
   * receives the query ID as input and returns the query text, `null`, or a
   * promise that resolves with query text or `null`.
   */
  queryMap: PromiseOrValue<QueryMap>;

  /**
   * Specifies whether only persisted queries are allowed. When `strict` is
   * `true`, any request that contains the query text or that does not contain a
   * valid query ID is considered invalid and results in a `400 Bad Request`
   * error response.
   */
  strict?: boolean;
}

export type Options = PromiseOrValue<OptionsData>;

export interface ParsedOptions extends Omit<Required<OptionsData>, 'queryMap'> {
  queryMap: LooseQueryMap;
}
