const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const root = path.resolve(__dirname, '..');
const shared = { '@sbtltv/core': 'core', '@sbtltv/local-adapter': 'local-adapter', '@sbtltv/data': 'data' };
const config = getDefaultConfig(__dirname);
config.watchFolders = [...Object.values(shared).map((p) => path.join(root, p)), path.join(root, 'electron/src')];
// npm leaves expo-modules-core and a few others nested under expo/ (not hoisted), where expo-asset and expo-sqlite
// can't see them: search there too.
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules'), path.join(__dirname, 'node_modules/expo/node_modules')];
config.resolver.resolveRequest = (context, name, platform) => {
  if (shared[name]) return { type: 'sourceFile', filePath: path.join(root, shared[name], 'src/index.ts') };
  // The shared packages import their own files as './x.js' (TypeScript ESM style): those are .ts on disk.
  if (name.startsWith('.') && name.endsWith('.js')) {
    try { return context.resolveRequest(context, name.slice(0, -3) + '.ts', platform); } catch { /* fall through */ }
  }
  return context.resolveRequest(context, name, platform);
};
module.exports = config;
