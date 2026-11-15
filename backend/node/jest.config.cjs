const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  moduleDirectories: ['<rootDir>/node_modules', 'node_modules', '<rootDir>/../../node_modules'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  moduleNameMapper: {
    '^typeorm$': require.resolve('typeorm', { paths: [__dirname, path.resolve(__dirname, '../..')] }),
  },
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        diagnostics: {
          ignoreCodes: [7016],
        },
        tsconfig: {
          target: 'ES2020',
          module: 'commonjs',
          lib: ['ES2020'],
          strict: true,
          strictPropertyInitialization: false,
          esModuleInterop: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          typeRoots: [
            path.resolve(__dirname, 'node_modules/@types'),
            path.resolve(__dirname, '../../node_modules/@types'),
          ],
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
