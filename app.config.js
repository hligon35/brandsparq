const { withAndroidManifest } = require("expo/config-plugins");

module.exports = ({ config }) => {
  const plugins = [...(config.plugins || [])];

  if (!plugins.includes("expo-status-bar")) {
    plugins.push("expo-status-bar");
  }

  const nextConfig = { ...config, plugins };

  // Only the isolated emulator build talks to the loopback fixture server over HTTP.
  if (process.env.BRANDSPARQ_E2E_BUILD !== "1") {
    return nextConfig;
  }

  return {
    ...nextConfig,
    ios: {
      ...nextConfig.ios,
      infoPlist: {
        ...nextConfig.ios?.infoPlist,
        NSAppTransportSecurity: {
          ...nextConfig.ios?.infoPlist?.NSAppTransportSecurity,
          NSAllowsLocalNetworking: true,
          NSAllowsArbitraryLoads: true,
        },
      },
    },
    plugins: [
      ...plugins,
      (nativeConfig) =>
        withAndroidManifest(nativeConfig, (result) => {
          const application = result.modResults.manifest.application?.[0];
          if (!application) {
            throw new Error("Android application manifest is missing.");
          }
          application.$["android:usesCleartextTraffic"] = "true";
          return result;
        }),
    ],
  };
};
