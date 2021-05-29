import type { ParsedMediaType } from 'content-type';
import contentType from 'content-type';
import getStream, { MaxBufferError } from 'get-stream';
import httpError from 'http-errors';
import querystring from 'querystring';
import type { Gunzip, Inflate } from 'zlib';
import { createGunzip, createInflate } from 'zlib';
import {
  CONTENT_TYPE_FORM_URL_ENCODED,
  CONTENT_TYPE_JSON,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_PAYLOAD_TOO_LARGE,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
  UNIT_KIB,
} from './constants';
import { nonNull } from './typeguards';
import type { Request } from './types';

const MAX_BUFFER_SIZE_KIB = 100;

function parseJsonObject(json: string): Record<string, unknown> {
  if (!/^[ \t\n\r]*{/.test(json)) {
    throw new Error('Not a JSON object.');
  }

  return JSON.parse(json) as Record<string, unknown>;
}

function isCharsetSupported(charset: string): charset is 'utf-8' | 'utf8' | 'utf16le' {
  return charset === 'utf8' || charset === 'utf-8' || charset === 'utf16le';
}

function getStreamFromRequest(req: Request, encoding: string): Gunzip | Inflate | Request {
  switch (encoding) {
    case 'deflate':
      return req.pipe(createInflate());
    case 'gzip':
      return req.pipe(createGunzip());
    case 'identity':
      return req;
    default:
      throw httpError(
        HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
        `Unsupported Content-Encoding: "${encoding}".`,
      );
  }
}

async function readRawBody(req: Request, contentTypeInfo: ParsedMediaType): Promise<string> {
  const charset = contentTypeInfo.parameters.charset?.toLowerCase() ?? 'utf-8';

  if (!isCharsetSupported(charset)) {
    throw httpError(
      HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
      `Unsupported charset "${charset.toUpperCase()}".`,
    );
  }

  const contentEncoding = req.headers['content-encoding'];
  const encoding = contentEncoding?.toLowerCase() ?? 'identity';
  const maxBuffer = MAX_BUFFER_SIZE_KIB * UNIT_KIB;
  const stream = getStreamFromRequest(req, encoding);

  try {
    const body = await getStream(stream, { encoding: charset, maxBuffer });

    return body;
  } catch (unknownError: unknown) {
    /* istanbul ignore else: cannot make get-stream throw other error. */
    if (unknownError instanceof MaxBufferError) {
      throw httpError(HTTP_STATUS_PAYLOAD_TOO_LARGE, 'Request body too large.');
    } else {
      const errorMessage =
        unknownError instanceof Error ? unknownError.message : String(unknownError);

      throw httpError(HTTP_STATUS_BAD_REQUEST, `Invalid request body: ${errorMessage}.`);
    }
  }
}

export async function parseRequestBodyIfNecessary(req: Request): Promise<void> {
  if (nonNull(req.body)) {
    return;
  }

  if (req.headers['content-type'] == null) {
    return;
  }

  const contentTypeInfo = contentType.parse(req);

  if (contentTypeInfo.type === CONTENT_TYPE_JSON) {
    const rawBody = await readRawBody(req, contentTypeInfo);

    try {
      req.body = parseJsonObject(rawBody);

      return;
    } catch {
      throw httpError(HTTP_STATUS_BAD_REQUEST, 'Request body is not a valid JSON object.');
    }
  }

  if (contentTypeInfo.type === CONTENT_TYPE_FORM_URL_ENCODED) {
    const rawBody = await readRawBody(req, contentTypeInfo);

    req.body = querystring.parse(rawBody);

    return;
  }
}
