// Stub for 'react-native-svg/css'.
//
// react-native-qrcode-svg imports LocalSvg from there for its embedded-logo
// feature, which drags in css-tree 1.x — a package Metro chokes on. We never
// render logos inside QR codes, so this import gets aliased to a no-op via
// metro.config.js instead of shipping a broken CSS parser.
const LocalSvg = () => null;

module.exports = {
  LocalSvg,
  WithLocalSvg: LocalSvg,
  SvgCss: LocalSvg,
  SvgCssUri: LocalSvg,
  SvgWithCss: LocalSvg,
  SvgWithCssUri: LocalSvg,
  inlineStyles: () => '',
};
