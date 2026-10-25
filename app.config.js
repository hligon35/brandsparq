const { withAndroidManifest } = require("expo/config-plugins");

module.exports = ({ config }) => {
  const plugins = [...(config.plugins || [])];

  if (!plugins.includes("expo-status-bar")) {
    plugins.push("expo-status-bar");
  }

  let nextConfig = { ...config, plugins };
  if (process.env.BRANDSPARQ_APP_ENV === "staging") {
    const api = process.env.EXPO_PUBLIC_API_URL || "";
    if (!/^https:\/\/brandsparq-staging\.[a-z0-9-]+\.workers\.dev$/.test(api))
      throw new Error(
        "Staging builds require EXPO_PUBLIC_API_URL set to the isolated staging HTTPS origin.",
      );
    nextConfig = {
      ...nextConfig,
      name: "BrandSparQ Staging",
      scheme: "brandsparq-staging",
      ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.staging` },
      android: { ...config.android, package: `${config.android.package}.staging` },
    };
  }
  if (
    process.env.BRANDSPARQ_E2E_BUILD === "1" &&
    process.env.EAS_BUILD_PROFILE &&
    process.env.EAS_BUILD_PROFILE !== "e2e"
  )
    throw new Error("Fixture HTTP networking is restricted to the e2e build profile.");

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
