import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface DialogAction {
  text: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  icon?: IconName;
  onClose: () => void;
  actions: DialogAction[];
}

function actionStyle(variant: DialogAction['variant']) {
  if (variant === 'primary') return styles.primaryBtn;
  if (variant === 'danger') return styles.dangerBtn;
  return styles.secondaryBtn;
}

function actionTextStyle(variant: DialogAction['variant']) {
  return variant === 'primary' || variant === 'danger' ? styles.lightActionText : styles.actionText;
}

export default function ThemedDialog({
  visible,
  title,
  message,
  icon,
  onClose,
  actions,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.titleRow}>
              {icon ? (
                <View style={styles.iconBadge}>
                  <MaterialCommunityIcons name={icon} size={20} color={colors.primary} />
                </View>
              ) : null}
              <Text style={styles.title}>{title}</Text>
            </View>
            <TouchableOpacity hitSlop={8} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color={colors.subtext} />
            </TouchableOpacity>
          </View>

          {message ? <Text style={styles.message}>{message}</Text> : null}

          <View style={styles.actions}>
            {actions.map((action) => {
              const variant = action.variant ?? 'secondary';
              return (
                <TouchableOpacity
                  key={action.text}
                  style={[
                    styles.actionBtn,
                    actionStyle(variant),
                    action.disabled && styles.disabledBtn,
                  ]}
                  disabled={action.disabled}
                  onPress={action.onPress}
                >
                  {action.icon ? (
                    <MaterialCommunityIcons
                      name={action.icon}
                      size={16}
                      color={variant === 'secondary' ? colors.text : '#fff'}
                    />
                  ) : null}
                  <Text style={actionTextStyle(variant)}>{action.text}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  message: {
    color: colors.subtext,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
  },
  secondaryBtn: {
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dangerBtn: {
    backgroundColor: colors.danger,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  actionText: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  lightActionText: {
    flexShrink: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
