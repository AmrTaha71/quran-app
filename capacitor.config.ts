import type { CapacitorConfig } from '@capacitor/cli';

// Android wrapper (2026-11-13): same web app inside a native shell so the
// adhan and the smart Fajr alarm can fire with the app closed, via exact
// alarms (LocalNotifications). See docs/ANDROID_BUILD.md.
const config: CapacitorConfig = {
  appId: 'app.tarbitat.quran',
  appName: 'تربيطات آيات القرآن',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_icon', iconColor: '#047857' },
  },
};
export default config;
