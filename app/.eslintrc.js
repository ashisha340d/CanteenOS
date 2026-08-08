module.exports = {
  root: true,
  extends: ['expo'],
  ignorePatterns: ['/dist/*', 'node_modules/*'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
};
