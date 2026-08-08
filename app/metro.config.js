// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `@menuboard/shared` is installed as a `file:../shared` dependency, which npm links as a
// symlink into node_modules pointing at the sibling `shared/` directory. Metro does not
// watch or resolve through a symlink to a folder outside the project root by default, so
// without this the bundler cannot see the package at all ("Unable to resolve
// @menuboard/shared") even though the symlink and the compiled `shared/dist` output are
// both present on disk.
const workspaceRoot = path.resolve(__dirname, '..');
config.watchFolders = [path.resolve(workspaceRoot, 'shared')];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
