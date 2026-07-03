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
  // subscribing to settings re-renders tabs on accent/language change
  useSettings();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.subtext,
        tabBarLabelStyle: { fontSize: 9 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Helix', tabBarLabel: t('Home'), tabBarIcon: tabIcon('view-dashboard') }}
      />
      <Tabs.Screen
        name="mesh"
        options={{ title: t('Bed Mesh'), tabBarLabel: t('Mesh'), tabBarIcon: tabIcon('grid') }}
      />
      <Tabs.Screen
        name="spoolman"
        options={{ title: 'Spoolman', tabBarLabel: 'Spools', tabBarIcon: tabIcon('paper-roll-outline') }}
      />
      <Tabs.Screen
        name="console"
        options={{ title: t('Console'), tabBarLabel: t('Console'), tabBarIcon: tabIcon('console') }}
      />
      <Tabs.Screen
        name="files"
        options={{ title: t('Files'), tabBarLabel: t('Files'), tabBarIcon: tabIcon('folder-outline') }}
      />
      <Tabs.Screen
        name="ace"
        options={{ title: 'multiACE', tabBarLabel: 'ACE', tabBarIcon: tabIcon('palette-swatch') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: t('Settings'), tabBarLabel: t('Settings'), tabBarIcon: tabIcon('cog') }}
      />
    </Tabs>
  );
}
