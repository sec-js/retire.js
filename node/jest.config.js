// eslint-disable-next-line no-undef
module.exports = {
  transform: {
    '^.+\\.ts?$': [
      'ts-jest',
      { tsconfig: 'tsconfig.spec.json' },
    ],
  },
  testEnvironment: 'node',
  testRegex: '/tests/.*\\.(test|spec)?\\.(ts|tsx)$',
  moduleFileExtensions: ['ts', 'js' ],
};