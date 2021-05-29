import httpError from 'http-errors';
import { URLSearchParams } from 'url';
import { HTTP_STATUS_BAD_REQUEST } from './constants';
import { isObject, isString } from './typeguards';
import type { LooseQueryMap, Maybe, Request } from './types';

interface Param {
  queryIdKey: string;
  queryMap: LooseQueryMap;
  req: Request;
  strict: boolean;
}

export async function getPersistedQuery({
  queryIdKey,
  queryMap,
  req,
  strict,
}: Param): Promise<Maybe<string>> {
  const searchParams = new URLSearchParams(req.url.split('?')[1]);

  if (strict && searchParams.has('query')) {
    throw httpError(
      HTTP_STATUS_BAD_REQUEST,
      'Search params have "query" but only persisted queries are allowed.',
    );
  }

  const { body } = req;

  if (strict && isObject(body) && 'query' in body) {
    throw httpError(
      HTTP_STATUS_BAD_REQUEST,
      'Request body has "query" but only persisted queries are allowed.',
    );
  }

  const queryId = searchParams.get(queryIdKey) ?? (isObject(body) ? body[queryIdKey] : null);

  if (!isString(queryId)) {
    if (strict) {
      throw httpError(
        HTTP_STATUS_BAD_REQUEST,
        `Request must provide a query ID under "${queryIdKey}" key either in search params or request body.`,
      );
    }

    return null;
  }

  let persistedQuery: unknown = null;

  if (typeof queryMap === 'function') {
    persistedQuery = await queryMap(queryId);
  } else if (Object.prototype.hasOwnProperty.call(queryMap, queryId)) {
    persistedQuery = queryMap[queryId];
  }

  if (!isString(persistedQuery)) {
    throw httpError(
      HTTP_STATUS_BAD_REQUEST,
      `The provided query ID "${queryId}" did not match any persisted query.`,
    );
  }

  return persistedQuery;
}
