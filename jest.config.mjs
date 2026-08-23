/**
 * @type {import('jest').Config}
 */
export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup.ts'],

  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', decorators: false },
          target: 'es2022',
        },
        module: { type: 'es6' },
        sourceMaps: 'inline',
      },
    ],
  },

  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main/server.ts',
  ],

  coverageThreshold: {
    global: {
      statements: 100,
    },
  },

  coverageReporters: ['text', 'text-summary', 'lcov'],
  clearMocks: true,
  restoreMocks: true,
};
