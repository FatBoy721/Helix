import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSettings } from '../../hooks/useSettings';
import { t } from '../../services/i18n';
import { getSharedModelFile } from '../../services/nativeSlicer';
import { setPendingModel } from '../../services/pendingModel';
import { colors } from '../../constants/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function tabIcon(name: IconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <MaterialCommunityIcons name={name} color={color} size={size - 2} />
  );
}

export default function TabLayout() {
  useSettings();
  const router = useRouter();
  // Issue #5: on 3-button-navigation devices the Android nav bar overlaps the
  // tab bar (the app draws edge-to-edge). Pad the bar by the system inset.
  const insets = useSafeAreaInsets();

  // "Open with Helix" (.3mf/.stl) can arrive on any tab, so consume the launch
  // intent here at the root, then jump to the Slicer. The intent reads once, so
  // the file is stashed for the Slicer screen to pick up.
  useEffect(() => {
    let alive = true;
    const check = () => {
      getSharedModelFile()
        .then((file) => {
          if (!alive || !file) return;
          setPendingModel(file);
          router.navigate('/slicer');
        })
        .catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [router]);

  return (
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
  );
}
