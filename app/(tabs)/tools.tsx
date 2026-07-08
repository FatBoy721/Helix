import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, spacing } from '../../constants/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const TOOLS: {
  title: string;
  subtitle: string;
  icon: IconName;
  route: string;
}[] = [
  {
    title: 'Bed Mesh',
    subtitle: 'View the current mesh and surface shape.',
    icon: 'grid',
    route: '/mesh',
  },
  {
    title: 'Spoolman',
    subtitle: 'Manage spools, filament usage, and labels.',
    icon: 'paper-roll-outline',
    route: '/spoolman',
  },
  {
    title: 'Console',
    subtitle: 'Send commands and read printer responses.',
    icon: 'console',
    route: '/console',
  },
  {
    title: 'multiACE',
    subtitle: 'Load, unload, dry, and switch filament lanes.',
    icon: 'palette-swatch',
    route: '/ace',
  },
];

export default function ToolsScreen() {
  const router = useRouter();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.grid}>
        {TOOLS.map((tool) => (
          <TouchableOpacity
            key={tool.route}
            style={styles.toolCard}
            activeOpacity={0.84}
            onPress={() => router.push(tool.route as never)}
          >
            <View style={styles.iconBox}>
              <MaterialCommunityIcons name={tool.icon} size={24} color={colors.primary} />
            </View>
            <View style={styles.toolText}>
              <Text style={styles.toolTitle}>{tool.title}</Text>
              <Text style={styles.toolSubtitle}>{tool.subtitle}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.subtext} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl + 80,
    gap: spacing.md,
  },
  grid: {
    gap: spacing.sm,
  },
  toolCard: {
    minHeight: 78,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolText: {
    flex: 1,
    gap: 3,
  },
  toolTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  toolSubtitle: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});
