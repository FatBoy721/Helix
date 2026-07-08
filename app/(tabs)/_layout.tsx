import React from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSettings } from '../../hooks/useSettings';
import { t } from '../../services/i18n';
import { colors } from '../../constants/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function tabIcon(name: IconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <MaterialCommunityIcons name={name} color={color} size={size - 2} />
  );
}

export default function TabLayout() {
  useSettings();

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
          height: 66,
          paddingTop: 5,
          paddingBottom: 7,
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
