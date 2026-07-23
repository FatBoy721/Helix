import React, { useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ThemedDialog from '../../components/ThemedDialog';
import { useSettings } from '../../hooks/useSettings';
import { t } from '../../services/i18n';
import { getSharedModelFile, takeNativePrintSentNotice } from '../../services/nativeSlicer';
import { setPendingModel } from '../../services/pendingModel';
import { colors } from '../../constants/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function tabIcon(name: IconName) {
  function TabBarIcon({ color, size }: { color: string; size: number }) {
    return <MaterialCommunityIcons name={name} color={color} size={size - 2} />;
  }

  return TabBarIcon;
}

export default function TabLayout() {
  useSettings();
  const router = useRouter();
  // Issue #5: on 3-button-navigation devices the Android nav bar overlaps the
  // tab bar (the app draws edge-to-edge). Pad the bar by the system inset.
  const insets = useSafeAreaInsets();
  const [nativePrintFilename, setNativePrintFilename] = useState<string | null>(null);

  // Native preview results and "Open with Helix" files can arrive on any tab,
  // so consume their one-shot intents here before choosing the destination.
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const filename = await takeNativePrintSentNotice();
        if (!alive) return;
        if (filename) {
          setNativePrintFilename(filename);
          router.navigate('/');
          return;
        }

        const file = await getSharedModelFile();
        if (!alive || !file) return;
        setPendingModel(file);
        router.navigate('/slicer');
      } catch {
        // Intent checks are best-effort and retry the next time the app activates.
      }
    };
    void check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    const linkSub = Linking.addEventListener('url', () => void check());
    return () => {
      alive = false;
      sub.remove();
      linkSub.remove();
    };
  }, [router]);

  return (
    <>
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '800' },
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            height: 66 + insets.bottom,
            paddingTop: 5,
            paddingBottom: 7 + insets.bottom,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: -3 },
            elevation: 10,
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.subtext,
          tabBarLabelStyle: { fontSize: 9, fontWeight: '700', marginTop: -2 },
          tabBarItemStyle: { paddingVertical: 0 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Helix',
            headerShown: false,
            tabBarLabel: t('Home'),
            tabBarIcon: tabIcon('home-variant'),
          }}
        />
        <Tabs.Screen
          name="mesh"
          options={{ title: t('Bed Mesh'), headerShown: false, href: null }}
        />
        <Tabs.Screen
          name="spoolman"
          options={{ title: 'Spoolman', href: null }}
        />
        <Tabs.Screen
          name="console"
          options={{ title: t('Console'), href: null }}
        />
        <Tabs.Screen
          name="files"
          options={{ title: t('Files'), tabBarLabel: t('Files'), tabBarIcon: tabIcon('folder-outline') }}
        />
        <Tabs.Screen
          name="ace"
          options={{ title: 'multiACE', href: null }}
        />
        <Tabs.Screen
          name="slicer"
          options={{ title: 'Slicer', tabBarLabel: 'Slice', tabBarIcon: tabIcon('cube-outline') }}
        />
        <Tabs.Screen
          name="tools"
          options={{ title: 'Tools', tabBarLabel: 'Tools', tabBarIcon: tabIcon('view-grid-outline') }}
        />
        <Tabs.Screen
          name="settings"
          options={{ title: t('Settings'), tabBarLabel: t('Settings'), tabBarIcon: tabIcon('cog') }}
        />
      </Tabs>

      <ThemedDialog
        visible={nativePrintFilename !== null}
        placement="center"
        title="Print sent successfully"
        message={nativePrintFilename ? `${nativePrintFilename.split('/').pop()} is now starting on the printer.` : undefined}
        icon="check-circle-outline"
        onClose={() => setNativePrintFilename(null)}
        actions={[
          {
            text: t('OK'),
            icon: 'check',
            variant: 'primary',
            onPress: () => setNativePrintFilename(null),
          },
        ]}
      />
    </>
  );
}
