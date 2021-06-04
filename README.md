# A Middleware for Persisted Queries with express-graphql

[![Code Coverage Status](https://codecov.io/gh/kyarik/express-graphql-persisted-queries/branch/main/graph/badge.svg?token=ct9Fb3Z9Pw)](https://codecov.io/gh/kyarik/express-graphql-persisted-queries)
[![CI Build Status](https://github.com/kyarik/express-graphql-persisted-queries/workflows/CI/badge.svg?branch=main)](https://github.com/kyarik/express-graphql-persisted-queries/actions?query=branch%3Amain)
[![npm version](https://badge.fury.io/js/express-graphql-persisted-queries.svg)](https://badge.fury.io/js/express-graphql-persisted-queries)

`express-graphql-persisted-queries` is an HTTP server middleware for persisted queries designed to work with [`express-graphql`](https://github.com/graphql/express-graphql).

`express-graphql-persisted-queries` gives you a lot of flexibility by allowing you to specify a custom query ID key, a custom way to map a query ID to an actual query, and whether you want to allow only persisted queries for enhanced security.

`express-graphql-persisted-queries` also allows you to specify the persisted query ID both in the search params of a GET request and in the body of a POST request. This means that you can send HTTP GET requests for your GraphQL queries and laverage HTTP caching. This also means that you can preload queries with `<link rel="preload">`, starting to load data in parallel with code on the first page load.

Just like `express-graphql`, this middleware works with any HTTP web framework that supports connect styled middleware, including [Connect](https://github.com/senchalabs/connect), [Express](https://github.com/expressjs/express), and [Restify](https://github.com/restify/node-restify).

## Installation

Using yarn:

```
yarn add express-graphql-persisted-queries
```

Using npm:

```
npm install express-graphql-persisted-queries
```

## Usage

`express-graphql-persisted-queries` exports its middleware as the `persistedQueries` named export. So, you should import it as follows:

```ts
// Using ES modules
import { persistedQueries } from 'express-graphql-persisted-queries';

// Using CommonJS
const { persistedQueries } = require('express-graphql-persisted-queries');
```

Here's an example of the most basic usage, which assumes that we are sending the query ID under the `queryId` key in the search params or request body, and that we store the mapping from query ID to query in a JSON file.

```ts
import queryMap from './queryMap.json';

app.use('/graphql', persistedQueries({ queryMap }), graphqlHTTP({ schema }));
```

Notice that the `persistedQueries` middleware should be used before `graphqlHTTP`.

Here's a more advanced example in which we specify a custom query ID key, use the database to map the query ID to a query, and allow only persisted queries in production:

```ts
app.use(
  '/graphql',
  persistedQueries({
    queryIdKey: 'id',
    queryMap: (queryId) => getQueryTextFromDatabase(queryId),
    strict: process.env.NODE_ENV === 'production',
  }),
  graphqlHTTP({ schema }),
);
```

## API

```ts
persistedQueries(options: Options): Middleware
```

### Parameters

- `options: Options` are the middleware options:

  - `queryIdKey?: string` (default: `'queryId'`) is the key in the search params or request body that specifies the ID of the persisted query.
  - `queryMap: QueryMap` is either an object mapping query IDs to query text or a function that receives the query ID as input and returns the query text, `null`, or a promise that resolves with query text or `null`. The `QueryMap` type is defined as follows:
    ```ts
    type QueryMap = Record<string, Maybe<string>> | QueryMapFn;
    type QueryMapFn = (queryId: string) => PromiseOrValue<Maybe<string>>;
    ```
  - `strict?: boolean` (default: `false`) specifies whether only persisted queries are allowed. When `strict` is `true`, any request that contains the query text or that does not contain a valid query ID is considered invalid and results in a `400 Bad Request` error response.

### Return value

- `Middleware` an HTTP server middleware.

### Description

`persistedQueries` is used to create a middleware that adds support for persisted queries to your GraphQL HTTP server. This middleware should be specified before `graphqlHTTP` from `express-graphql`.

### Example

```ts
app.use(
  '/graphql',
  persistedQueries({
    queryMap,
    strict: process.env.NODE_ENV === 'production',
  }),
  graphqlHTTP({ schema }),
);
```

## Contributing

Pull requests are very welcome. If you intend to introduce a major change, please open a related issue first in which we can discuss what you would like to change.

Please make sure to update the tests and the README as appropriate.

## License

[MIT](https://github.com/kyarik/express-graphql-persisted-queries/blob/main/LICENSE)
