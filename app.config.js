const appJson = require('./app.json');

module.exports = () => ({
  ...appJson.expo,
  extra: {
    ...(appJson.expo.extra || {}),
    buildCommit: process.env.GITHUB_SHA || process.env.EXPO_PUBLIC_BUILD_COMMIT || 'dev',
    buildDate: process.env.BUILD_DATE || new Date().toISOString(),
  },
});
