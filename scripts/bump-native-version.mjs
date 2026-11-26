// 9.12 (2026-11-26): raise the native app versions together before a
// store release: `node scripts/bump-native-version.mjs 1.1`.
// - Android: versionCode +1, versionName = the given version.
// - iOS: CURRENT_PROJECT_VERSION +1, MARKETING_VERSION = the given version.
// (The web/PWA side needs nothing: the build stamps the SW cache, 10.13.)
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+(\.\d+)?$/.test(version || '')) {
  console.error('usage: node scripts/bump-native-version.mjs <version, e.g. 1.1>');
  process.exit(1);
}

const gradle = 'android/app/build.gradle';
let g = readFileSync(gradle, 'utf8');
g = g.replace(/versionCode (\d+)/, (_, n) => `versionCode ${Number(n) + 1}`)
     .replace(/versionName "[^"]*"/, `versionName "${version}"`);
writeFileSync(gradle, g);

const pbx = 'ios/App/App.xcodeproj/project.pbxproj';
let p = readFileSync(pbx, 'utf8');
p = p.replace(/CURRENT_PROJECT_VERSION = (\d+);/g, (_, n) => `CURRENT_PROJECT_VERSION = ${Number(n) + 1};`)
     .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
writeFileSync(pbx, p);

console.log(`native versions -> ${version} (build numbers +1)`);
