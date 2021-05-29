import { assert } from './assert';
import { isFunction, isObject, isString } from './typeguards';
import type { ParsedOptions } from './types';

export async function parseOptions(promiseOrOptions: unknown): Promise<ParsedOptions> {
  const options = await promiseOrOptions;

  assert(
    isObject(options),
    'The options passed to persistedQueries must be an object or a promise that resolves with an object.',
  );

  const queryMap = await options.queryMap;

  assert(
    isObject(queryMap) || isFunction(queryMap),
    'options.queryMap must be an object, a function, or a promise that resolves with an object or function.',
  );

  const queryIdKey = isString(options.queryIdKey) ? options.queryIdKey : 'queryId';
  const strict = Boolean(options.strict);

  return {
    queryIdKey,
    queryMap,
    strict,
  };
}
