import { persistedQueries } from 'express-graphql-persisted-queries';

type Maybe<T> = T | null | undefined;

type PromiseOrValue<T> = Promise<T> | T;

persistedQueries({
  queryMap: {
    greetGuest: '{ greet }',
  },
});

persistedQueries({
  queryMap: Promise.resolve({
    greetGuest: '{ greet }',
  }),
});

persistedQueries({
  queryMap: (queryId: string): Maybe<string> => (queryId ? '{ greet }' : null),
});

persistedQueries({
  queryMap: async (queryId: string): Promise<Maybe<string>> =>
    Promise.resolve(queryId ? '{ greet }' : null),
});

persistedQueries({
  queryMap: (queryId: string): PromiseOrValue<Maybe<string>> => (queryId ? '{ greet }' : null),
});

persistedQueries({
  queryMap: Promise.resolve((queryId: string): Maybe<string> => (queryId ? '{ greet }' : null)),
});

persistedQueries({
  queryIdKey: 'id',
  queryMap: {
    greetGuest: '{ greet }',
  },
  strict: true,
});

persistedQueries(
  Promise.resolve({
    queryMap: {
      greetGuest: '{ greet }',
    },
  }),
);

persistedQueries(
  Promise.resolve({
    queryMap: Promise.resolve({
      greetGuest: '{ greet }',
    }),
  }),
);
