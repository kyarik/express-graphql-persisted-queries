module.exports = {
  env: {
    browser: false,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:node/recommended',
    'plugin:@typescript-eslint/all',
    'prettier',
  ],
  parserOptions: {
    ecmaVersion: 2020,
    project: './tsconfig.json',
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/naming-convention': [
      'error',
      {
        selector: 'default',
        format: ['camelCase'],
        leadingUnderscore: 'allow',
        trailingUnderscore: 'allow',
      },
      {
        selector: 'variable',
        format: ['camelCase', 'UPPER_CASE'],
        leadingUnderscore: 'allow',
        trailingUnderscore: 'allow',
      },
      {
        selector: 'typeLike',
        format: ['PascalCase'],
      },
      {
        selector: 'enumMember',
        format: ['PascalCase'],
      },
    ],
    '@typescript-eslint/no-magic-numbers': [
      'error',
      { ignoreArrayIndexes: true, ignoreEnums: true },
    ],
    '@typescript-eslint/no-type-alias': [
      'error',
      {
        allowAliases: 'always',
        allowCallbacks: 'always',
        allowLiterals: 'never',
        allowMappedTypes: 'never',
      },
    ],
    '@typescript-eslint/prefer-readonly-parameter-types': 'off',
    'node/no-missing-import': 'off',
    'node/no-unsupported-features/es-syntax': 'off',
  },
  ignorePatterns: [
    '/coverage',
    '/dist',
    '/integration-tests/**/*.js',
    '/integration-tests/typescript/index.ts',
    '/node_modules',
  ],
};
