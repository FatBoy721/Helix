const { withPodfile } = require('@expo/config-plugins');

module.exports = function withFmtXcode26Fix(config) {
  return withPodfile(config, (podfileConfig) => {
    const marker = '# Xcode 26 fmt compatibility';
    if (podfileConfig.modResults.contents.includes(marker)) return podfileConfig;

    const postInstallCall = `    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )`;
    const fmtOverride = `
    # Xcode 26 fmt compatibility
    installer.pods_project.targets.each do |target|
      next unless target.name == 'fmt'

      target.build_configurations.each do |build_config|
        build_config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
      end
    end`;
    podfileConfig.modResults.contents = podfileConfig.modResults.contents.replace(
      postInstallCall,
      `${postInstallCall}${fmtOverride}`,
    );

    return podfileConfig;
  });
};
