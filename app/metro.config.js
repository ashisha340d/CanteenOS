// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDefaultConfig } = require('expo/metro-config');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolve } = require('metro-resolver');

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

// Zustand ships an ESM build that uses `import.meta.url`. Metro's web target bundles it as a
// plain script, which causes a runtime SyntaxError. Force the CJS build for web.
const zustandRoot = path.resolve(__dirname, 'node_modules', 'zustand');
const defaultResolveRequest = config.resolver.resolveRequest ?? resolve;
config.resolver.resolveRequest = (context, moduleName, platform, options) => {
  if (platform === 'web' && moduleName === 'zustand') {
    return { filePath: path.join(zustandRoot, 'index.js'), type: 'sourceFile' };
  }
  if (platform === 'web' && moduleName.startsWith('zustand/')) {
    const subpath = moduleName.slice('zustand/'.length);
    return { filePath: path.join(zustandRoot, `${subpath}.js`), type: 'sourceFile' };
  }
  return defaultResolveRequest(context, moduleName, platform, options);
};

module.exports = config;
