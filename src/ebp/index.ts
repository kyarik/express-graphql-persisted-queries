import contentType from 'content-type';
import httpError from 'http-errors';
import querystring from 'querystring';
import {
  CONTENT_TYPE_FORM_URL_ENCODED,
  CONTENT_TYPE_JSON,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
} from './constants';
import { parseJsonObject } from './parseJsonObject';
import { parseOptions } from './parseOptions';
import { readRawBody } from './readRawBody';
import { sendJson } from './sendJson';
import { nonNull } from './typeguards';
import type { Middleware, Options } from './types';

export function bodyParser(options: Options = {}): Middleware {
  const { maxSize } = parseOptions(options);

  return async function bodyParserMiddleware(req, res, next): Promise<void> {
    try {
      if (nonNull(req.body) || req.headers['content-type'] == null) {
        next();

        return;
      }

      const contentTypeInfo = contentType.parse(req);

      if (contentTypeInfo.type === CONTENT_TYPE_JSON) {
        const rawBody = await readRawBody({ contentTypeInfo, maxSize, req });

        try {
          req.body = parseJsonObject(rawBody);

          next();

          return;
        } catch {
          throw httpError(HTTP_STATUS_BAD_REQUEST, 'Request body is not a valid JSON object.');
        }
      }

      if (contentTypeInfo.type === CONTENT_TYPE_FORM_URL_ENCODED) {
        const rawBody = await readRawBody({ contentTypeInfo, maxSize, req });

        req.body = querystring.parse(rawBody);

        next();

        return;
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

      const result = {
        errors: [{ message: error.message }],
      };

      sendJson(res, result);
    }
  };
}
