const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// react-native-svg/css pulls in css-tree@1.x which Metro can't bundle.
// qrcode-svg only touches it for embedded QR logos (unused here) — see the
// stub for details.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react-native-svg/css') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'shims/react-native-svg-css-stub.js'),
    };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
