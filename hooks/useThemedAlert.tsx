import React, { useCallback, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ThemedDialog, { type DialogAction } from '../components/ThemedDialog';
import { t } from '../services/i18n';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface ThemedAlertAction {
  text: string;
  onPress?: () => unknown;
  variant?: DialogAction['variant'];
  disabled?: boolean;
}

export interface ThemedAlertOptions {
  title: string;
  message?: string;
  icon?: IconName;
  actions?: ThemedAlertAction[];
}

export function useThemedAlert() {
  const [alert, setAlert] = useState<ThemedAlertOptions | null>(null);
  const closeAlert = useCallback(() => setAlert(null), []);
  const showAlert = useCallback((options: ThemedAlertOptions) => setAlert(options), []);

  const actions: DialogAction[] = (alert?.actions ?? [{ text: t('OK'), variant: 'primary' }]).map(
    (action) => ({
      text: action.text,
      variant: action.variant,
      disabled: action.disabled,
      onPress: () => {
        closeAlert();
        void action.onPress?.();
      },
    })
  );

  const alertDialog = (
    <ThemedDialog
      visible={alert != null}
      title={alert?.title ?? ''}
      message={alert?.message}
      icon={alert?.icon}
      placement="center"
      onClose={closeAlert}
      actions={actions}
    />
  );

  return { showAlert, alertDialog };
}
