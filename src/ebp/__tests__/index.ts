import { json as jsonBodyParser, text as textBodyParser } from 'body-parser';
import connect from 'connect';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import { deflateSync, gzipSync } from 'zlib';
import { bodyParser } from '..';
import { assert } from '../assert';
import {
  CONTENT_TYPE_JSON,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_OK,
  HTTP_STATUS_PAYLOAD_TOO_LARGE,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
  UNIT_KIB,
} from '../constants';
import type { Middleware, Request, Response } from '../types';

type MulterFile = Express.Multer.File;

interface RequestWithMulterFile extends Request {
  file: MulterFile;
}

interface App {
  use: (...middlewares: Middleware[]) => void;
}

interface RequestBodyReader {
  req: {
    body?: unknown;
  };
  readerMiddleware: Middleware;
}

function createReqBodyReader(): RequestBodyReader {
  const _req: RequestBodyReader['req'] = {};

  function readerMiddleware(req: Request, res: Response): void {
    _req.body = req.body;

    res.end();
  }

  return {
    readerMiddleware,
    req: _req,
  };
}

function runTests(createApp: () => App): void {
  it('requires options to be an object or undefined', () => {
    expect(() => {
      // @ts-expect-error Invalid usage
      bodyParser(null);
    }).toThrow(new TypeError('The options passed to the bodyParser middleware must be an object.'));

    expect(() => {
      // @ts-expect-error Invalid usage
      bodyParser('hello');
    }).toThrow(new TypeError('The options passed to the bodyParser middleware must be an object.'));

    expect(() => {
      bodyParser({ maxSize: 5000 });
    }).not.toThrow();

    expect(() => {
      bodyParser();
    }).not.toThrow();
  });

  it('sets the parsed JSON body as the "body" property on the request', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    await request(app).post('/').send({ foo: 'bar' });

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('sets the parsed form urlencoded body as the "body" property on the request', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    await request(app).post('/').send('foo=bar');

    expect(JSON.stringify(req.body)).toStrictEqual(JSON.stringify({ foo: 'bar' }));
  });

  it('handles a gzipped body', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const gzippedBody = gzipSync(
      JSON.stringify({
        foo: 'bar',
      }),
    );

    const savedRequest = request(app).post('/').type('json').set('Content-Encoding', 'gzip');

    savedRequest.write(gzippedBody);

    await savedRequest;

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('handles a deflated body', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const deflatedBody = deflateSync(
      JSON.stringify({
        foo: 'bar',
      }),
    );

    const savedRequest = request(app).post('/').type('json').set('Content-Encoding', 'deflate');

    savedRequest.write(deflatedBody);

    await savedRequest;

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('allows to have space in a JSON body', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    await request(app)
      .post('/')
      .type('json')
      .send(' \t\n\r{ \t\n\r "foo": \t\n\r "bar" \t\n\r } \t\n\r');

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('allows a JSON body without space', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    await request(app).post('/').type('json').send('{"foo":"bar"}');

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('ignores requests without a body', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    await request(app).get('/');

    expect(req.body).toBe(undefined);
  });

  it('does not interfere with file uploads', async () => {
    const app = createApp();

    const _req: { body?: unknown; file?: MulterFile } = {};

    function readerMiddleware(req: Request, res: Response): void {
      _req.body = req.body;
      _req.file = (req as RequestWithMulterFile).file;

      res.end();
    }

    app.use(bodyParser(), multer().single('file') as Middleware, readerMiddleware);

    await request(app)
      .post('/')
      .field('foo', 'bar')
      .attach('file', Buffer.from('test'), 'test.txt');

    expect(JSON.stringify(_req.body)).toEqual(JSON.stringify({ foo: 'bar' }));
    expect(_req.file?.originalname).toBe('test.txt');
    expect(_req.file?.mimetype).toBe('text/plain');
  });

  it('does nothing when the body was already parsed', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(jsonBodyParser(), bodyParser(), readerMiddleware);

    await request(app).post('/').send({ foo: 'bar' });

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('ignores a body with an unsupported Content-Type', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    await request(app).post('/').type('application/graphql').send('{ greet }');

    expect(req.body).toBe(undefined);
  });

  it('does not consume a body with an unsupported Content-Type', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), textBodyParser({ type: 'application/graphql' }), readerMiddleware);

    await request(app).post('/').type('application/graphql').send('{ greet }');

    expect(req.body).toBe('{ greet }');
  });

  it('errors when JSON body is not an object', async () => {
    const app = createApp();

    const { readerMiddleware } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const response = await request(app).post('/').send([]);

    expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
    expect(response.body).toStrictEqual({
      errors: [
        {
          message: 'Request body is not a valid JSON object.',
        },
      ],
    });
  });

  it('errors when JSON body is an incomplete object', async () => {
    const app = createApp();

    const { readerMiddleware } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const response = await request(app).post('/').type('json').send('{ "foo": "bar"');

    expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
    expect(response.body).toStrictEqual({
      errors: [
        {
          message: 'Request body is not a valid JSON object.',
        },
      ],
    });
  });

  it('errors when the body has an unsupported charset but known Content-Type', async () => {
    const app = createApp();

    const { readerMiddleware } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const response = await request(app)
      .post('/')
      .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=ascii`)
      .send(JSON.stringify({ foo: 'bar' }));

    expect(response.status).toBe(HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE);
    expect(response.body).toStrictEqual({
      errors: [
        {
          message: 'Unsupported charset "ASCII".',
        },
      ],
    });
  });

  it('errors when the body has an unsupported UTF charset', async () => {
    const app = createApp();

    const { readerMiddleware } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const response = await request(app)
      .post('/')
      .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=utf-18`)
      .send(JSON.stringify({ foo: 'bar' }));

    expect(response.status).toBe(HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE);
    expect(response.body).toStrictEqual({
      errors: [
        {
          message: 'Unsupported charset "UTF-18".',
        },
      ],
    });
  });

  it('ignores a body that has an unsupported charset and unknown Content-Type', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const response = await request(app)
      .post('/')
      .set('Content-Type', 'application/graphql; charset=ascii')
      .send(JSON.stringify({ foo: 'bar' }));

    expect(response.status).toBe(HTTP_STATUS_OK);
    expect(req.body).toBe(undefined);
  });

  it('parses a body with utf8 charset', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    await request(app)
      .post('/')
      .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=utf8`)
      .send(JSON.stringify({ foo: 'bar' }));

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('parses a body with utf-8 charset', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    await request(app)
      .post('/')
      .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=utf-8`)
      .send(JSON.stringify({ foo: 'bar' }));

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('parses a body with utf16le charset', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const body = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf16le').toString();

    await request(app)
      .post('/')
      .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=utf16le`)
      .send(body);

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('defaults the charset to utf-8', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    await request(app)
      .post('/')
      .set('Content-Type', CONTENT_TYPE_JSON)
      .send(JSON.stringify({ foo: 'bar' }));

    expect(req.body).toStrictEqual({ foo: 'bar' });
  });

  it('errors when the body has an unknown Content-Encoding but known Content-Type', async () => {
    const app = createApp();

    const { readerMiddleware } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const response = await request(app)
      .post('/')
      .set('Content-Type', CONTENT_TYPE_JSON)
      .set('Content-Encoding', 'numbers')
      .send('0123456789');

    expect(response.status).toBe(HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE);
    expect(response.body).toStrictEqual({
      errors: [
        {
          message: 'Unsupported Content-Encoding: "numbers".',
        },
      ],
    });
  });

  it('ignores a body that has an unknown Content-Encoding and unknown Content-Type', async () => {
    const app = createApp();

    const { readerMiddleware, req } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const response = await request(app)
      .post('/')
      .set('Content-Type', 'application/graphql')
      .set('Content-Encoding', 'numbers')
      .send('0123456789');

    expect(response.status).toBe(HTTP_STATUS_OK);
    expect(req.body).toBe(undefined);
  });

  describe('"maxSize" option', () => {
    it('causes an error response when the body exceeds the specified max size', async () => {
      const app = createApp();
      const maxSize = 5000;

      const { readerMiddleware } = createReqBodyReader();

      app.use(bodyParser({ maxSize }), readerMiddleware);

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = maxSize + 1;
      const body = Buffer.alloc(byteLength, 'foo=bar&description=I love GraphQL').toString();

      assert(body.length === byteLength, 'String length needs to equal byte length');

      const response = await request(app).post('/').send(body);

      expect(response.status).toBe(HTTP_STATUS_PAYLOAD_TOO_LARGE);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Request body too large.',
          },
        ],
      });
    });

    it('allows a body that does not exceed the specified max size', async () => {
      const app = createApp();
      const maxSize = 5000;

      const { readerMiddleware, req } = createReqBodyReader();

      app.use(bodyParser({ maxSize }), readerMiddleware);

      const byteLength = maxSize;
      const body = Buffer.alloc(byteLength, 'foo=bar&description=I love GraphQL').toString();

      assert(body.length === byteLength, 'String length needs to equal byte length');

      await request(app).post('/').send(body);

      expect(req.body).toStrictEqual(expect.objectContaining({ foo: 'bar' }));
    });

    it('takes into account the body byte length, not string length', async () => {
      const app = createApp();
      const maxSize = 5000;

      const { readerMiddleware } = createReqBodyReader();

      app.use(bodyParser({ maxSize }), readerMiddleware);

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = maxSize + 1;
      const body = Buffer.alloc(byteLength, 'foo=bar&description=I ♥ GraphQL').toString();

      assert(body.length < byteLength, 'String length needs to be less than byte length');

      const response = await request(app).post('/').send(body);

      expect(response.status).toBe(HTTP_STATUS_PAYLOAD_TOO_LARGE);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Request body too large.',
          },
        ],
      });
    });

    it('causes an error response when a JSON body exceeds the max size', async () => {
      const app = createApp();
      const maxSize = 5000;

      const { readerMiddleware } = createReqBodyReader();

      app.use(bodyParser({ maxSize }), readerMiddleware);

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = maxSize + 1;
      const body = Buffer.alloc(byteLength, '{ "foo": "bar" }').toString();
      const response = await request(app).post('/').type('json').send(body);

      expect(response.status).toBe(HTTP_STATUS_PAYLOAD_TOO_LARGE);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Request body too large.',
          },
        ],
      });
    });

    it('causes an error response when a form urlencoded body exceeds the max size', async () => {
      const app = createApp();
      const maxSize = 5000;

      const { readerMiddleware } = createReqBodyReader();

      app.use(bodyParser({ maxSize }), readerMiddleware);

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = maxSize + 1;
      const body = Buffer.alloc(byteLength, 'foo=bar&description=I love GraphQL').toString();
      const response = await request(app).post('/').send(body);

      expect(response.status).toBe(HTTP_STATUS_PAYLOAD_TOO_LARGE);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Request body too large.',
          },
        ],
      });
    });

    it('does not cause an error response when an unknown body exceeds the max size', async () => {
      const app = createApp();
      const maxSize = 5000;

      const { readerMiddleware, req } = createReqBodyReader();

      app.use(bodyParser({ maxSize }), readerMiddleware);

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = maxSize + 1;
      const body = Buffer.alloc(byteLength, '{ greet } #').toString();
      const response = await request(app)
        .post('/')
        .set('Content-Type', 'application/graphql')
        .send(body);

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(req.body).toBe(undefined);
    });

    it('causes an error response when the body exceeds 100 KiB by default', async () => {
      const app = createApp();

      const { readerMiddleware } = createReqBodyReader();

      app.use(bodyParser(), readerMiddleware);

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = 100 * UNIT_KIB + 1;
      const body = Buffer.alloc(byteLength, 'foo=bar&description=I love GraphQL').toString();
      const response = await request(app).post('/').send(body);

      expect(response.status).toBe(HTTP_STATUS_PAYLOAD_TOO_LARGE);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Request body too large.',
          },
        ],
      });
    });

    it('handles a body that does not exceed 100 KiB by default', async () => {
      const app = createApp();

      const { readerMiddleware, req } = createReqBodyReader();

      app.use(bodyParser(), readerMiddleware);

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = 100 * UNIT_KIB;
      const body = Buffer.alloc(byteLength, 'foo=bar&description=I love GraphQL').toString();
      await request(app).post('/').send(body);

      expect(req.body).toStrictEqual(expect.objectContaining({ foo: 'bar' }));
    });
  });

  it('sends error responses with correct Content-Type and Content-Length', async () => {
    const app = createApp();

    const { readerMiddleware } = createReqBodyReader();

    app.use(bodyParser(), readerMiddleware);

    const response = await request(app).post('/').send([]);

    const expectedBody = {
      errors: [
        {
          message: 'Request body is not a valid JSON object.',
        },
      ],
    };

    expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
    expect(response.body).toStrictEqual(expectedBody);
    expect(response.get('Content-Type')).toBe(`${CONTENT_TYPE_JSON}; charset=utf-8`);
    expect(response.get('Content-Length')).toBe(String(JSON.stringify(expectedBody).length));
  });
}

describe('bodyParser functionality with an Express server', () => {
  runTests(() => {
    const app = express();

    app.on('error', (error) => {
      console.error('Express server error:', error);
    });

    return app;
  });
});

describe('bodyParser functionality with a Connect server', () => {
  runTests(() => {
    const app = connect();

    app.on('error', (error) => {
      console.error('Connect server error:', error);
    });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalAppUse = app.use;

    const appUse: App['use'] = (...middlewares) => {
      middlewares.forEach((middleware) => {
        (originalAppUse as App['use']).call(app, middleware);
      });
    };

    Object.defineProperty(app, 'use', { value: appUse });

    return app;
  });
});
