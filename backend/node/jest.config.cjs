module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  setupFilesAfterEnv: ['reflect-metadata'],
  moduleDirectories: ['node_modules', '<rootDir>/node_modules', '<rootDir>/../../node_modules'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
};
