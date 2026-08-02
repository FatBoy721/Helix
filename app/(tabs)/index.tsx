// Home — the redesigned Cockpit dashboard.
//
// All home logic lives in components/dashboard/Dashboard.tsx (fed by
// hooks/useDashboardModel + the dashboard/parts modules). This is just the
// route shell.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Dashboard from '../../components/dashboard/Dashboard';
import { COCKPIT } from '../../components/dashboard/shared';

export default function HomeScreen() {
  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.flex} edges={['top']}>
        <Dashboard />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COCKPIT.bg },
  flex: { flex: 1 },
});
