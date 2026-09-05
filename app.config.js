const appJson = require('./app.json');

module.exports = () => {
  // Helix distributes through GitHub releases, so the in-app updater is on by
  // default; set HELIX_DISTRIBUTION=play to build a store variant that defers
  // to the Play listing instead.
  const distribution = process.env.HELIX_DISTRIBUTION === 'play' ? 'play' : 'github';

  return {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra || {}),
      buildCommit: process.env.GITHUB_SHA || process.env.EXPO_PUBLIC_BUILD_COMMIT || 'dev',
      buildDate: process.env.BUILD_DATE || new Date().toISOString(),
      distribution,
    },
  };
};
