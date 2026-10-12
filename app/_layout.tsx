import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import '../src/i18n';

export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
