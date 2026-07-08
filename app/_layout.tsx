import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { SettingsProvider, useSettings } from '../hooks/useSettings';
import { MoonrakerProvider } from '../hooks/useMoonraker';
import FirstRunSetup from '../components/FirstRunSetup';
import { initNotifications } from '../services/notifications';
import { getSharedMakerWorldLink } from '../services/nativeSlicer';
import { colors } from '../constants/theme';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.card,
    border: colors.border,
    text: colors.text,
    primary: colors.primary,
  },
};

export default function RootLayout() {
  useEffect(() => {
    initNotifications();
  }, []);

  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AppShell />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const { settings, loaded } = useSettings();
  const router = useRouter();

  useEffect(() => {
    getSharedMakerWorldLink().then((shared) => {
      if (shared.hasMakerWorldUrl) {
        router.replace('/slicer');
      }
    }).catch(() => {});
  }, [router]);

  return (
    <>
      <MoonrakerProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="makerworld-login" options={{ presentation: 'modal' }} />
            <Stack.Screen name="makerworld-download" options={{ presentation: 'modal' }} />
          </Stack>
        </ThemeProvider>
      </MoonrakerProvider>
      <FirstRunSetup visible={loaded && settings.printers.length === 0} />
    </>
  );
}
