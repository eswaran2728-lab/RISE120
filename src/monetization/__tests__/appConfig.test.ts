// app.config.js adds the AdMob plugin. The App ID is a public identifier that comes from the EAS build
// environment; without one the build uses Google's public sample App ID, which only ever serves test ads.
const SAMPLE_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

function resolve(env: Record<string, string | undefined>) {
  const original = { ...process.env };
  jest.resetModules();
  for (const key of ['ADMOB_ANDROID_APP_ID', 'EAS_BUILD_PROFILE']) delete process.env[key];
  Object.assign(process.env, env);
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const factory = require('../../../app.config.js');
    return factory({ config: require('../../../app.json').expo });
    /* eslint-enable @typescript-eslint/no-require-imports */
  } finally {
    process.env = original;
  }
}

const adsPlugin = (config: { plugins: unknown[] }) =>
  config.plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-google-mobile-ads') as [string, { androidAppId: string }] | undefined;

describe('app.config.js', () => {
  it('keeps everything from app.json and adds the ads plugin with the sample App ID by default', () => {
    const config = resolve({});

    expect(config.android.package).toBe('com.eswaran2728.rise120');
    expect(config.plugins).toContain('expo-router');
    expect(adsPlugin(config)?.[1].androidAppId).toBe(SAMPLE_APP_ID);
  });

  it('uses the AdMob App ID from the build environment when one is set', () => {
    const config = resolve({ ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456~1234567890' });

    expect(adsPlugin(config)?.[1].androidAppId).toBe('ca-app-pub-1234567890123456~1234567890');
  });

  it('ignores a malformed App ID rather than building with it', () => {
    expect(adsPlugin(resolve({ ADMOB_ANDROID_APP_ID: 'not-an-app-id' }))?.[1].androidAppId).toBe(SAMPLE_APP_ID);
  });

  it('refuses to build a production app with the sample App ID', () => {
    expect(() => resolve({ EAS_BUILD_PROFILE: 'production' })).toThrow('ADMOB_ANDROID_APP_ID');
    expect(adsPlugin(resolve({ EAS_BUILD_PROFILE: 'production', ADMOB_ANDROID_APP_ID: 'ca-app-pub-1234567890123456~1234567890' }))).toBeDefined();
  });

  it('keeps the top-level app.json key the ads library needs to build for Android', () => {
    // Without it the library's Gradle script fails with "Cannot get property 'googleMobileAdsJson'" (seen on EAS).
    const appJson = require('../../../app.json');

    expect(appJson['react-native-google-mobile-ads']).toEqual(expect.any(Object));
  });
});
