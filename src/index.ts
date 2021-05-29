import type { FormattedExecutionResult } from 'graphql';
import { formatError, GraphQLError } from 'graphql';
import httpError from 'http-errors';
import { assert } from './assert';
import { HTTP_STATUS_INTERNAL_SERVER_ERROR } from './constants';
import { getPersistedQuery } from './getPersistedQuery';
import { parseOptions } from './parseOptions';
import { parseRequestBodyIfNecessary } from './parseRequestBodyIfNecessary';
import { sendJson } from './sendJson';
import { isObject, isString, nonNull } from './typeguards';
import type { Middleware, Options } from './types';

/**
 * Creates an Express middleware that adds support for persisted queries. This
 * middleware should be specified before `graphqlHTTP` from `express-graphql`.
 * @param options Options to customize the middleware behavior.
 * @returns An Express middleware.
 * @example
 * app.use('/graphql', persistedQueries({ queryMap }), graphqlHTTP({ schema }));
 */
export function persistedQueries(options: Options): Middleware {
  assert(nonNull(options), 'You must provide options to the persistedQueries middleware.');

  const parsedOptions = parseOptions(options);

  parsedOptions.catch(console.error);

  return async function persistedQueriesMiddleware(req, res, next): Promise<void> {
    try {
      const { queryIdKey, queryMap, strict } = await parsedOptions;

      await parseRequestBodyIfNecessary(req);

      const persistedQuery = await getPersistedQuery({ queryIdKey, queryMap, req, strict });

      if (isString(persistedQuery)) {
        if (isObject(req.body)) {
          req.body.query = persistedQuery;
        } else {
          req.body = { query: persistedQuery };
        }
      }

      next();
    } catch (unknownError: unknown) {
      const error = httpError(
        HTTP_STATUS_INTERNAL_SERVER_ERROR,
        unknownError instanceof Error
          ? unknownError
          : /* istanbul ignore next: cannot get a non-Error to be thrown */ String(unknownError),
      );

      res.statusCode = error.statusCode;

      const graphqlError = new GraphQLError(
        error.message,
        undefined,
        undefined,
        undefined,
        undefined,
        error,
      );

      const result: FormattedExecutionResult = {
        data: undefined,
        errors: [formatError(graphqlError)],
      };

      sendJson(res, result);
    }
  };
}
