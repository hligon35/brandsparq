const { withAndroidManifest } = require("expo/config-plugins");

// Only the isolated emulator build talks to the loopback fixture server over HTTP.
module.exports = ({ config }) => {
  if (process.env.BRANDSPARQ_E2E_BUILD !== "1") return config;
  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSAppTransportSecurity: {
          NSAllowsLocalNetworking: true,
          NSAllowsArbitraryLoads: true,
        },
      },
    },
    plugins: [
      ...(config.plugins || []),
      (nativeConfig) =>
        withAndroidManifest(nativeConfig, (result) => {
          const application = result.modResults.manifest.application?.[0];
          if (!application) throw new Error("Android application manifest is missing.");
          application.$["android:usesCleartextTraffic"] = "true";
          return result;
        }),
    ],
  };
};
