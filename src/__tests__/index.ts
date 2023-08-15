import bodyParser from 'body-parser';
import connect from 'connect';
import express from 'express';
import { graphqlHTTP } from 'express-graphql';
import {
  GraphQLBoolean,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import multer from 'multer';
import type { Server as Restify } from 'restify';
import request from 'supertest';
import { deflateSync, gzipSync } from 'zlib';
import { persistedQueries } from '..';
import { assert } from '../assert';
import {
  CONTENT_TYPE_JSON,
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_OK,
  HTTP_STATUS_PAYLOAD_TOO_LARGE,
  HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE,
  UNIT_KIB,
} from '../constants';
import { isString } from '../typeguards';
import type { Middleware, Request } from '../types';

type MulterFile = Express.Multer.File;

interface RequestWithMulterFile extends Request {
  file: MulterFile;
}

const queryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    greet: {
      type: new GraphQLNonNull(GraphQLString),
      args: {
        name: { type: GraphQLString },
      },
      resolve: (_, args: { name?: string }): string => `Hello ${args.name ?? 'guest'}!`,
    },
    error: {
      type: GraphQLString,
      resolve: (): never => {
        throw new Error('An error!');
      },
    },
  },
});

const mutationType = new GraphQLObjectType({
  name: 'Mutation',
  fields: {
    like: {
      type: GraphQLBoolean,
      resolve: (): boolean => true,
    },
  },
});

const schema = new GraphQLSchema({
  query: queryType,
  mutation: mutationType,
});

const queryMap = {
  greetGuest: '{ greet }',
  greetJohn: '{ greet(name: "John") }',
  greetWorld: 'query GreetWorldQuery { greet(name: "world") }',
  greetName: 'query GreetQuery($name: String!) { greet(name: $name) }',
  greetJohnOrWorld: `
    query GreetJohnQuery {
      greet(name: "John")
    }

    query GreetWorldQuery {
      greet(name: "World")
    }
  `,
  invalid: '{ greet, invalidField }',
  error: '{ error }',
  like: 'mutation LikeMutation { like }',
};

interface SearchParams {
  operationName?: string;
  query?: string;
  queryId?: string;
  id?: string;
  variables?: Record<string, unknown>;
}

function searchString(params: SearchParams): string {
  return new URLSearchParams(
    Object.entries(params).map(([key, value]) => [
      key,
      isString(value) ? value : JSON.stringify(value),
    ]),
  ).toString();
}

function endpoint(params?: SearchParams): string {
  if (!params) {
    return '/graphql';
  }

  return `/graphql?${searchString(params)}`;
}

interface App {
  use: (...middlewares: Middleware[]) => void;
  get: (path: string, ...middlewares: Middleware[]) => void;
  post: (path: string, ...middlewares: Middleware[]) => void;
}

function runTests(createApp: () => App): void {
  describe('Options', () => {
    it('requires options to be passed', () => {
      expect(() => {
        // @ts-expect-error Invalid usage
        persistedQueries();
      }).toThrow(new Error('You must provide options to the persistedQueries middleware.'));

      expect(() => {
        // @ts-expect-error Invalid usage
        persistedQueries(null);
      }).toThrow(new Error('You must provide options to the persistedQueries middleware.'));
    });

    it('requires an options promise to not resolve with null', async () => {
      const app = createApp();
      const spy = jest.spyOn(console, 'error').mockImplementation();

      app.get(
        endpoint(),
        // @ts-expect-error Invalid usage
        persistedQueries(Promise.resolve(null)),
      );

      const response = await request(app).get(endpoint());

      expect(response.status).toBe(HTTP_STATUS_INTERNAL_SERVER_ERROR);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message:
              'The options passed to persistedQueries must be an object or a promise that resolves with an object.',
          },
        ],
      });
      expect(console.error).toHaveBeenCalledWith(
        new TypeError(
          'The options passed to persistedQueries must be an object or a promise that resolves with an object.',
        ),
      );

      spy.mockRestore();
    });

    it('allows options to be an object', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('allows options to be a promise that resolves with an object', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries(Promise.resolve({ queryMap })), graphqlHTTP({ schema }));

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('handles a rejected options promise', async () => {
      const app = createApp();
      const spy = jest.spyOn(console, 'error').mockImplementation();

      app.get(
        endpoint(),
        persistedQueries(Promise.reject(new Error('Failed to resolve options.'))),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_INTERNAL_SERVER_ERROR);
      expect(response.body).toStrictEqual({
        errors: [{ message: 'Failed to resolve options.' }],
      });

      expect(console.error).toHaveBeenCalledWith(new Error('Failed to resolve options.'));

      spy.mockRestore();
    });
  });

  describe('GET requests', () => {
    it('queries a simple persisted query', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('queries a persisted query with variables', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(
        endpoint({
          queryId: 'greetName',
          variables: {
            name: 'Jessica',
          },
        }),
      );

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello Jessica!',
        },
      });
    });

    it('queries a persisted query with an operation name', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(
        endpoint({
          queryId: 'greetJohnOrWorld',
          operationName: 'GreetWorldQuery',
        }),
      );

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello World!',
        },
      });
    });

    it('returns an error when the operation name of a persisted query is missing', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(
        endpoint({
          queryId: 'greetJohnOrWorld',
        }),
      );

      expect(response.status).toBe(HTTP_STATUS_INTERNAL_SERVER_ERROR);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Must provide operation name if query contains multiple operations.',
          },
        ],
      });
    });

    it('returns an error for an invalid persisted query', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(
        endpoint({
          queryId: 'invalid',
        }),
      );

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Cannot query field "invalidField" on type "Query".',
            locations: [{ line: 1, column: 10 }],
          },
        ],
      });
    });

    it('returns an error when search params are missing', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(endpoint());

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Must provide query string.',
          },
        ],
      });
    });

    it('returns an error when the search params string is empty', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(`${endpoint()}?`);

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Must provide query string.',
          },
        ],
      });
    });
  });

  describe('POST requests', () => {
    it('queries a simple persisted query', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).post(endpoint()).send({ queryId: 'greetJohn' });

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello John!',
        },
      });
    });

    it('performs a persisted mutation', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).post(endpoint()).send({ queryId: 'like' });

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          like: true,
        },
      });
    });

    it('handles form-urlencoded payload', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .send(searchString({ queryId: 'greetJohn' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello John!',
        },
      });
    });

    it('queries a persisted query with variables', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .send({
          queryId: 'greetName',
          variables: {
            name: 'Jessica',
          },
        });

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello Jessica!',
        },
      });
    });

    it('handles form-urlencoded payload with variables', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .send(
          searchString({
            queryId: 'greetName',
            variables: {
              name: 'Jessica',
            },
          }),
        );

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello Jessica!',
        },
      });
    });

    it('queries a persisted query with query ID in body and variables in URL', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(
          endpoint({
            variables: {
              name: 'Jessica',
            },
          }),
        )
        .send({
          queryId: 'greetName',
        });

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello Jessica!',
        },
      });
    });

    it('queries a persisted query with query ID in form url-encoded body and variables in URL', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(
          endpoint({
            variables: {
              name: 'Jessica',
            },
          }),
        )
        .send(
          searchString({
            queryId: 'greetName',
          }),
        );

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello Jessica!',
        },
      });
    });

    it('queries a persisted query with an operation name', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).post(endpoint()).send({
        queryId: 'greetJohnOrWorld',
        operationName: 'GreetWorldQuery',
      });

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello World!',
        },
      });
    });

    it('handles gzipped body', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const gzippedBody = gzipSync(
        JSON.stringify({
          queryId: 'greetWorld',
        }),
      );

      const req = request(app).post(endpoint()).type('json').set('Content-Encoding', 'gzip');

      req.write(gzippedBody);

      const response = await req;

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello world!',
        },
      });
    });

    it('handles deflated body', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const deflatedBody = deflateSync(
        JSON.stringify({
          queryId: 'greetWorld',
        }),
      );

      const req = request(app).post(endpoint()).type('json').set('Content-Encoding', 'deflate');

      req.write(deflatedBody);

      const response = await req;

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello world!',
        },
      });
    });

    it('allows uploading files', async () => {
      const fileType = new GraphQLObjectType({
        name: 'File',
        fields: {
          originalname: {
            type: GraphQLString,
          },
          mimetype: {
            type: GraphQLString,
          },
        },
      });

      const schemaWithFileUploadMutation = new GraphQLSchema({
        query: queryType,
        mutation: new GraphQLObjectType({
          name: 'Mutation',
          fields: {
            uploadFile: {
              type: fileType,
              resolve: (_, __, req: RequestWithMulterFile): MulterFile => req.file,
            },
          },
        }),
      });

      const app = createApp();

      app.use(multer().single('file') as Middleware);

      app.post(
        endpoint(),
        persistedQueries({
          queryMap: {
            upload: `
              mutation UploadFileMutation {
                uploadFile {
                  originalname
                  mimetype
                }
              }
            `,
          },
        }),
        graphqlHTTP({ schema: schemaWithFileUploadMutation }),
      );

      const response = await request(app)
        .post(endpoint())
        .field('queryId', 'upload')
        .attach('file', Buffer.from('test'), 'test.txt');

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          uploadFile: {
            originalname: 'test.txt',
            mimetype: 'text/plain',
          },
        },
      });
    });

    it('handles the case in which the body was already parsed', async () => {
      const app = createApp();

      app.use(bodyParser.json());

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).post(endpoint()).send({
        queryId: 'greetJohn',
      });

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello John!',
        },
      });
    });

    it('ignores a pre-parsed body with an unknown type', async () => {
      const app = createApp();

      app.use(bodyParser.text({ type: 'application/unknown' }));

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .type('application/unknown')
        .send(searchString({ queryId: 'greetWorld' }));

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [{ message: 'Must provide query string.' }],
      });
    });

    it('returns an error when the operation name of a persisted query is missing', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).post(endpoint()).send({
        queryId: 'greetJohnOrWorld',
      });

      expect(response.status).toBe(HTTP_STATUS_INTERNAL_SERVER_ERROR);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Must provide operation name if query contains multiple operations.',
          },
        ],
      });
    });

    it('returns an error for an invalid persisted query', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).post(endpoint()).send({
        queryId: 'invalid',
      });

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Cannot query field "invalidField" on type "Query".',
            locations: [{ line: 1, column: 10 }],
          },
        ],
      });
    });

    it('correctly handles a queryId corresponding to a property on the object prototype', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).post(endpoint()).send({ queryId: 'toString' });

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'The provided query ID "toString" did not match any persisted query.',
          },
        ],
      });
    });
  });

  describe('"queryIdKey" option', () => {
    it('allows specifying a custom query ID key', async () => {
      const app = createApp();

      app.get(
        endpoint(),
        persistedQueries({ queryIdKey: 'id', queryMap }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ id: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('defaults to "queryId"', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });
  });

  describe('"queryMap" option', () => {
    it('is mandatory', async () => {
      const app = createApp();
      const spy = jest.spyOn(console, 'error').mockImplementation();

      app.get(
        endpoint(),
        // @ts-expect-error Invalid usage
        persistedQueries({}),
      );

      const response = await request(app).get(endpoint());

      expect(response.status).toBe(HTTP_STATUS_INTERNAL_SERVER_ERROR);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message:
              'options.queryMap must be an object, a function, or a promise that resolves with an object or function.',
          },
        ],
      });
      expect(console.error).toHaveBeenCalledWith(
        new TypeError(
          'options.queryMap must be an object, a function, or a promise that resolves with an object or function.',
        ),
      );

      spy.mockRestore();
    });

    it('can be an object', async () => {
      const app = createApp();

      app.get(
        endpoint(),
        persistedQueries({ queryMap: { greetGuest: '{ greet }' } }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('can be a promise that resolves with an object', async () => {
      const app = createApp();

      app.get(
        endpoint(),
        persistedQueries({ queryMap: Promise.resolve({ greetGuest: '{ greet }' }) }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('can map a not found query ID to null when it is an object', async () => {
      const app = createApp();

      app.get(
        endpoint(),
        persistedQueries({ queryMap: { greetGuest: null } }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'The provided query ID "greetGuest" did not match any persisted query.',
          },
        ],
      });
    });

    it('can map a not found query ID to undefined when it is an object', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap: {} }), graphqlHTTP({ schema }));

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'The provided query ID "greetGuest" did not match any persisted query.',
          },
        ],
      });
    });

    it('can be a function', async () => {
      const app = createApp();

      app.get(
        endpoint(),
        persistedQueries({
          queryMap: (queryId: string) => (queryId === 'greetGuest' ? '{ greet }' : null),
        }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('can be a promise that resolves with a function', async () => {
      const app = createApp();

      app.get(
        endpoint(),
        persistedQueries({
          queryMap: Promise.resolve((queryId: string) =>
            queryId === 'greetGuest' ? '{ greet }' : null,
          ),
        }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('can return a promise when it is a function', async () => {
      const app = createApp();

      app.get(
        endpoint(),
        persistedQueries({
          queryMap: async (queryId: string) =>
            Promise.resolve(queryId === 'greetGuest' ? '{ greet }' : null),
        }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('can return null for a not found query ID when it is a function', async () => {
      const app = createApp();

      app.get(
        endpoint(),
        persistedQueries({
          queryMap: () => null,
        }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'The provided query ID "greetGuest" did not match any persisted query.',
          },
        ],
      });
    });

    it('can return undefined for a not found query ID when it is a function', async () => {
      const app = createApp();

      app.get(
        endpoint(),
        persistedQueries({
          queryMap: () => undefined,
        }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'The provided query ID "greetGuest" did not match any persisted query.',
          },
        ],
      });
    });

    it('cannot be a promise that resolves with null', async () => {
      const app = createApp();
      const spy = jest.spyOn(console, 'error').mockImplementation();

      app.get(
        endpoint(),
        persistedQueries({
          // @ts-expect-error Invalid usage
          queryMap: Promise.resolve(null),
        }),
      );

      const response = await request(app).get(endpoint());

      expect(response.status).toBe(HTTP_STATUS_INTERNAL_SERVER_ERROR);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message:
              'options.queryMap must be an object, a function, or a promise that resolves with an object or function.',
          },
        ],
      });
      expect(console.error).toHaveBeenCalledWith(
        new TypeError(
          'options.queryMap must be an object, a function, or a promise that resolves with an object or function.',
        ),
      );

      spy.mockRestore();
    });

    it('cannot be a promise that rejects', async () => {
      const app = createApp();
      const spy = jest.spyOn(console, 'error').mockImplementation();

      app.get(
        endpoint(),
        persistedQueries({
          queryMap: Promise.reject(new Error('Failed to resolve options.queryMap.')),
        }),
        graphqlHTTP({ schema }),
      );

      const response = await request(app).get(endpoint({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_INTERNAL_SERVER_ERROR);
      expect(response.body).toStrictEqual({
        errors: [{ message: 'Failed to resolve options.queryMap.' }],
      });

      expect(console.error).toHaveBeenCalledWith(new Error('Failed to resolve options.queryMap.'));

      spy.mockRestore();
    });
  });

  describe('"strict" option', () => {
    describe('when set to false', () => {
      it('allows to specify non-persisted queries in search params', async () => {
        const app = createApp();

        app.get(endpoint(), persistedQueries({ queryMap, strict: false }), graphqlHTTP({ schema }));

        const response = await request(app).get(endpoint({ query: '{ greet }' }));

        expect(response.status).toBe(HTTP_STATUS_OK);
        expect(response.body).toStrictEqual({
          data: {
            greet: 'Hello guest!',
          },
        });
      });

      it('allows non-persisted queries in request body', async () => {
        const app = createApp();

        app.post(
          endpoint(),
          persistedQueries({ queryMap, strict: false }),
          graphqlHTTP({ schema }),
        );

        const response = await request(app).post(endpoint()).send({ query: '{ greet }' });

        expect(response.status).toBe(HTTP_STATUS_OK);
        expect(response.body).toStrictEqual({
          data: {
            greet: 'Hello guest!',
          },
        });
      });

      it('allows queryId to be missing', async () => {
        const app = createApp();

        app.get(endpoint(), persistedQueries({ queryMap, strict: false }), graphqlHTTP({ schema }));

        const response = await request(app).get(endpoint());

        expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
        expect(response.body).toStrictEqual({
          errors: [
            {
              message: 'Must provide query string.',
            },
          ],
        });
      });

      it('errors if the query ID is invalid', async () => {
        const app = createApp();

        app.get(endpoint(), persistedQueries({ queryMap, strict: false }), graphqlHTTP({ schema }));

        const response = await request(app).get(endpoint({ queryId: 'nonExistingQueryId' }));

        expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
        expect(response.body).toStrictEqual({
          errors: [
            {
              message:
                'The provided query ID "nonExistingQueryId" did not match any persisted query.',
            },
          ],
        });
      });
    });

    describe('when set to true', () => {
      it('does not allow to specify non-persisted queries in search params', async () => {
        const app = createApp();

        app.get(endpoint(), persistedQueries({ queryMap, strict: true }), graphqlHTTP({ schema }));

        const response = await request(app).get(endpoint({ query: '{ greet }' }));

        expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
        expect(response.body).toStrictEqual({
          errors: [
            {
              message: 'Search params have "query" but only persisted queries are allowed.',
            },
          ],
        });
      });

      it('does not allow non-persisted queries in request body', async () => {
        const app = createApp();

        app.post(endpoint(), persistedQueries({ queryMap, strict: true }), graphqlHTTP({ schema }));

        const response = await request(app).post(endpoint()).send({ query: '{ greet }' });

        expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
        expect(response.body).toStrictEqual({
          errors: [
            {
              message: 'Request body has "query" but only persisted queries are allowed.',
            },
          ],
        });
      });

      it('does not allow queryId to be missing', async () => {
        const app = createApp();

        app.get(endpoint(), persistedQueries({ queryMap, strict: true }), graphqlHTTP({ schema }));

        const response = await request(app).get(endpoint());

        expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
        expect(response.body).toStrictEqual({
          errors: [
            {
              message:
                'Request must provide a query ID under "queryId" key either in search params or request body.',
            },
          ],
        });
      });

      it('errors if the query ID is invalid', async () => {
        const app = createApp();

        app.get(endpoint(), persistedQueries({ queryMap, strict: true }), graphqlHTTP({ schema }));

        const response = await request(app).get(endpoint({ queryId: 'nonExistingQueryId' }));

        expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
        expect(response.body).toStrictEqual({
          errors: [
            {
              message:
                'The provided query ID "nonExistingQueryId" did not match any persisted query.',
            },
          ],
        });
      });
    });

    it('defaults to false', async () => {
      const app = createApp();

      app.get(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).get(endpoint({ query: '{ greet }' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });
  });

  describe('Body parsing', () => {
    it('ignores a body with an unsupported Content-Type', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .set('Content-Type', 'application/graphql; charset=utf-8')
        .send('{ greet }');

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('errors when JSON body is not an object', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app).post(endpoint()).send([]);

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

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .type('json')
        .send('{ "queryId": "greetGuest"');

      expect(response.status).toBe(HTTP_STATUS_BAD_REQUEST);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Request body is not a valid JSON object.',
          },
        ],
      });
    });

    it('errors when the body has an unsupported charset', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=ascii`)
        .send(JSON.stringify({ queryId: 'greetGuest' }));

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

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=utf-18`)
        .send(JSON.stringify({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_UNSUPPORTED_MEDIA_TYPE);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Unsupported charset "UTF-18".',
          },
        ],
      });
    });

    it('parses a body with utf8 charset', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=utf8`)
        .send(JSON.stringify({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('parses a body with utf-8 charset', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=utf-8`)
        .send(JSON.stringify({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('parses a body with utf16le charset', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const body = Buffer.from(JSON.stringify({ queryId: 'greetGuest' }), 'utf16le').toString();

      const response = await request(app)
        .post(endpoint())
        .set('Content-Type', `${CONTENT_TYPE_JSON}; charset=utf16le`)
        .send(body);

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('defaults the charset to utf-8', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
        .set('Content-Type', CONTENT_TYPE_JSON)
        .send(JSON.stringify({ queryId: 'greetGuest' }));

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('errors when the body has an unknown Content-Encoding', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      const response = await request(app)
        .post(endpoint())
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

    it('errors when the body exceeds 100 KiB', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = 100 * UNIT_KIB + 1;
      const body = Buffer.alloc(
        byteLength,
        'queryId=greetGuest&description=I love GraphQL',
      ).toString();

      assert(body.length === byteLength, 'String length needs to equal byte length');

      const response = await request(app).post(endpoint()).send(body);

      expect(response.status).toBe(HTTP_STATUS_PAYLOAD_TOO_LARGE);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Request body too large.',
          },
        ],
      });
    });

    it('handles a body that does not exceed 100 KiB', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = 100 * UNIT_KIB;
      const body = Buffer.alloc(
        byteLength,
        'queryId=greetGuest&description=I love GraphQL',
      ).toString();

      assert(body.length === byteLength, 'String length needs to equal byte length');

      const response = await request(app).post(endpoint()).send(body);

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello guest!',
        },
      });
    });

    it('takes into account the body byte length, not string length', async () => {
      const app = createApp();

      app.post(endpoint(), persistedQueries({ queryMap }), graphqlHTTP({ schema }));

      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const byteLength = 100 * UNIT_KIB + 1;
      const body = Buffer.alloc(
        byteLength,
        'queryId=greetGuest&description=I ♥ GraphQL',
      ).toString();

      assert(body.length < byteLength, 'String length needs to be less than byte length');

      const response = await request(app).post(endpoint()).send(body);

      expect(response.status).toBe(HTTP_STATUS_PAYLOAD_TOO_LARGE);
      expect(response.body).toStrictEqual({
        errors: [
          {
            message: 'Request body too large.',
          },
        ],
      });
    });

    it('sets the parsed body as the "body" property on the request', async () => {
      const app = createApp();

      // eslint-disable-next-line @typescript-eslint/init-declarations
      let seenRequest: Request | undefined;

      app.post(
        endpoint(),
        persistedQueries({ queryMap }),
        (req, _, next) => {
          seenRequest = req;

          next();
        },
        graphqlHTTP({ schema }),
      );

      const response = await request(app)
        .post(endpoint())
        .send({
          foo: 'bar',
          queryId: 'greetName',
          variables: {
            name: 'Jessica',
          },
        });

      expect(response.status).toBe(HTTP_STATUS_OK);
      expect(response.body).toStrictEqual({
        data: {
          greet: 'Hello Jessica!',
        },
      });

      expect(seenRequest?.body).toStrictEqual({
        foo: 'bar',
        query: 'query GreetQuery($name: String!) { greet(name: $name) }',
        queryId: 'greetName',
        variables: {
          name: 'Jessica',
        },
      });
    });
  });
}

describe('persistedQueries functionality with an Express server', () => {
  runTests(() => {
    const app = express();

    app.on('error', (error) => {
      console.error('Express server error:', error);
    });

    return app;
  });
});

describe('persistedQueries functionality with a Connect server', () => {
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

    const appMethod: App['get'] = (path, ...middlewares) => {
      middlewares.forEach((middleware) => {
        (originalAppUse as App['get']).call(app, path, middleware);
      });
    };

    Object.defineProperty(app, 'get', { value: appMethod });
    Object.defineProperty(app, 'post', { value: appMethod });
    Object.defineProperty(app, 'use', { value: appUse });

    return app as unknown as App;
  });
});

describe('persistedQueries functionality with a Restify server', () => {
  runTests(() => {
    // Note: We import restify using require instead of ES import in order to prevent
    // it from patching IncomingMessage and ServerResponse from NodeJS at the
    // very beginning. We first let the tests for Express and Connect run before
    // letting it patch those classes. Therefore, it is important to keep the
    // tests for Restify at the very end.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const { createServer } = require('restify') as { createServer: () => Restify };
    const app = createServer();

    app.on('error', (error) => {
      console.error('Restify server error:', error);
    });

    return app as App;
  });
});
