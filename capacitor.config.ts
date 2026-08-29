import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.github.dajiaohuang.solaratlas',
  appName: 'Solar Atlas',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#05080c',
    minWebViewVersion: 80,
  },
  ios: {
    backgroundColor: '#05080c',
    contentInset: 'never',
    preferredContentMode: 'mobile',
    minVersion: '16.4',
  },
}

export default config
