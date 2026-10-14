// Extends app.json. The AdMob App ID is a public identifier but differs per environment, so it comes from the
// EAS build environment (ADMOB_ANDROID_APP_ID) instead of being committed. Without one, development builds use
// Google's public sample App ID, which only ever serves test ads; a production build refuses to use it.
const SAMPLE_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;

module.exports = ({ config }) => {
  const fromEnv = process.env.ADMOB_ANDROID_APP_ID;
  const valid = typeof fromEnv === 'string' && APP_ID.test(fromEnv);
  if (!valid && process.env.EAS_BUILD_PROFILE === 'production') {
    throw new Error('ADMOB_ANDROID_APP_ID must be set to the real AdMob App ID for production builds');
  }
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ['react-native-google-mobile-ads', { androidAppId: valid ? fromEnv : SAMPLE_ANDROID_APP_ID }]],
  };
};

// Note: react-native-google-mobile-ads 17.2.0's Gradle script reads the raw app.json (not this resolved
// config) and fails the Android build unless app.json has a top-level "react-native-google-mobile-ads" key.
// That key is present in app.json on purpose; the App ID itself is set above, through the Expo plugin.
