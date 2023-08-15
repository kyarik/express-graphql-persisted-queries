import type { ParsedMediaType } from 'content-type';
import getStream, { MaxBufferError } from 'get-stream';
import httpError from 'http-errors';
import type { Gunzip, Inflate } from 'zlib';
import { createGunzip, createInflate } from 'zlib';
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_PAYLOAD_TOO_LARGE,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
} from './constants';
import type { Request } from './types';

function isCharsetSupported(charset: string): charset is 'utf-8' | 'utf8' | 'utf16le' {
  return charset === 'utf-8' || charset === 'utf8' || charset === 'utf16le';
}

function getDecompressedStream(req: Request, encoding: string): Gunzip | Inflate | Request {
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

interface Param {
  contentTypeInfo: ParsedMediaType;
  maxSize: number;
  req: Request;
}

export async function readRawBody({ contentTypeInfo, maxSize, req }: Param): Promise<string> {
  const charset = contentTypeInfo.parameters.charset?.toLowerCase() ?? 'utf-8';

  if (!isCharsetSupported(charset)) {
    throw httpError(
      HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
      `Unsupported charset "${charset.toUpperCase()}".`,
    );
  }

  const contentEncoding = req.headers['content-encoding'];
  const encoding = contentEncoding?.toLowerCase() ?? 'identity';
  const stream = getDecompressedStream(req, encoding);

  try {
    const bodyBuffer = await getStream.buffer(stream, { maxBuffer: maxSize });

    return bodyBuffer.toString(charset);
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
