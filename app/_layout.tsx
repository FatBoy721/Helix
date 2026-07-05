import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { SettingsProvider, useSettings } from '../hooks/useSettings';
import { MoonrakerProvider } from '../hooks/useMoonraker';
import FirstRunSetup from '../components/FirstRunSetup';
import { initNotifications } from '../services/notifications';
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
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
}

function AppShell() {
  const { settings, loaded } = useSettings();

  return (
    <>
      <MoonrakerProvider>
        <ThemeProvider value={theme}>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </ThemeProvider>
      </MoonrakerProvider>
      <FirstRunSetup visible={loaded && settings.printers.length === 0} />
    </>
  );
}
