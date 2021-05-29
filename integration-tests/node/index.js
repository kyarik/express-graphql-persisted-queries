'use strict';

const assert = require('assert');
const { GraphQLNonNull, GraphQLObjectType, GraphQLSchema, GraphQLString } = require('graphql');
const express = require('express');
const { graphqlHTTP } = require('express-graphql');
// @ts-ignore
const { persistedQueries } = require('express-graphql-persisted-queries');
const request = require('supertest');

const EXIT_FAILURE = 1;

const queryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    greet: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: () => 'Hello guest!',
    },
  },
});

const schema = new GraphQLSchema({
  query: queryType,
});

const queryMap = {
  greetGuest: '{ greet }',
};

async function test() {
  const app = express();

  app.get('/graphql', persistedQueries({ queryMap }), graphqlHTTP({ schema }));

  const response = await request(app).get('/graphql?queryId=greetGuest');

  assert.strictEqual(response.status, 200);

  assert.deepStrictEqual(response.body, {
    data: {
      greet: 'Hello guest!',
    },
  });
}

test().catch((error) => {
  console.error(error);

  process.exit(EXIT_FAILURE);
});
