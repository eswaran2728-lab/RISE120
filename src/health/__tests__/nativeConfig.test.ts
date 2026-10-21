import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const pluginNames = (app.plugins as unknown[]).map((p) => (Array.isArray(p) ? p[0] : p));

describe('Android Health Connect native configuration', () => {
  it('uses the Health Connect config plugin and a pinned library version', () => {
    expect(pluginNames).toContain('react-native-health-connect');
    expect(pkg.dependencies['react-native-health-connect']).toMatch(/^\d+\.\d+\.\d+$/); // exact: native code, reviewed at this version
  });

  it('raises the minimum Android version to 26, which the Health Connect client library needs', () => {
    const entry = (app.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === 'expo-build-properties') as [string, { android: { minSdkVersion: number } }];
    expect(entry[1].android.minSdkVersion).toBeGreaterThanOrEqual(26);
  });

  it('declares exactly the two read permissions, steps and sleep, and no other health permission', () => {
    const health = (app.android.permissions as string[]).filter((p) => p.startsWith('android.permission.health.'));

    expect(health.sort()).toEqual(['android.permission.health.READ_SLEEP', 'android.permission.health.READ_STEPS']);
  });

  it('declares no write permission and no background or history access', () => {
    const all = (app.android.permissions as string[]).join(' ');

    expect(all).not.toMatch(/WRITE_|BACKGROUND|HISTORY|CALORIES|HEART|WEIGHT|EXERCISE/i);
  });
});
