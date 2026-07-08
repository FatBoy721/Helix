import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, spacing } from '../constants/theme';
import { captureMakerWorldCookies, saveMakerWorldBearer } from '../services/nativeSlicer';

// Runs on each page load: scan localStorage for a JWT (MakerWorld's API access
// token lives there, not in the cookie) and report keys + any JWT back to RN.
const SCAN_LS = `(function(){
  try {
    var keys = [], jwt = '';
    for (var i=0;i<localStorage.length;i++){
      var k = localStorage.key(i); keys.push(k);
      var v = localStorage.getItem(k) || '';
      var m = v.match(/eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/);
      if (m && m[0].length > jwt.length) jwt = m[0];
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({t:'ls', keys:keys.join(','), jwt:jwt}));
  } catch(e){ window.ReactNativeWebView.postMessage(JSON.stringify({t:'ls', err:String(e)})); }
})(); true;`;

// In-app MakerWorld login. The user signs in here; Android's shared WebView
// CookieManager holds the session cookie afterwards, which the native module
// captures + stores encrypted. No password is ever read or stored — only the
// resulting session cookie, exactly like a browser.
//
// Matches the reference app (MakerWorldBrowserScreen): start on the homepage and
// let MakerWorld run its own Sign In. IMPORTANT: Google/Apple/Facebook block
// their login inside embedded WebViews (Google = "disallowed_useragent"), so we
// detect those and steer the user to EMAIL login, which works in-app and is what
// yields the session cookie we can capture.
const START_URL = 'https://makerworld.com/en';
const UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

function isBlockedAuthHost(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    return (
      host === 'accounts.google.com' ||
      host.endsWith('.accounts.google.com') ||
      host === 'appleid.apple.com' ||
      host === 'www.facebook.com' ||
      host === 'm.facebook.com'
    );
  } catch {
    return false;
  }
}

export default function MakerWorldLoginScreen() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(false);
  const lastCheck = useRef(0);

  const checkCookies = useCallback(async () => {
    const now = Date.now();
    if (now - lastCheck.current < 800) return;
    lastCheck.current = now;
    setChecking(true);
    try {
      const result = await captureMakerWorldCookies();
      if (result.hasAuth) setAuthed(true);
    } finally {
      setChecking(false);
    }
  }, []);

  const onMessage = useCallback((e: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.t === 'ls' && msg.jwt) {
        saveMakerWorldBearer(msg.jwt).catch(() => {});
      }
    } catch {
      // ignore
    }
  }, []);

  const onRequest = useCallback((req: WebViewNavigation): boolean => {
    if (isBlockedAuthHost(req.url)) {
      Alert.alert(
        'Use Email Login',
        'Google / Apple / Facebook block their sign-in inside in-app browsers. ' +
          'Log in with your MakerWorld (Bambu) email + password on this screen instead — ' +
          'that keeps you signed in here so downloads work.',
        [{ text: 'OK' }]
      );
      return false; // block the SSO nav in-webview
    }
    return true;
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <MaterialCommunityIcons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>MakerWorld Login</Text>
          <Text style={styles.subtitle}>
            {authed ? 'Signed in — session cookie stored (encrypted).' : 'Sign in with EMAIL (not Google).'}
          </Text>
        </View>
        {checking ? <ActivityIndicator color={colors.primary} /> : null}
        <TouchableOpacity onPress={() => Linking.openURL(START_URL)} style={styles.iconBtn} hitSlop={10}>
          <MaterialCommunityIcons name="open-in-new" size={20} color={colors.subtext} />
        </TouchableOpacity>
      </View>

      <WebView
        source={{ uri: START_URL }}
        userAgent={UA}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically
        // Route target=_blank / SSO popups into this same WebView instead of a
        // dead-end popup window (RN equivalent of the reference app's
        // onCreateWindow → mainWebView.loadUrl redirect).
        setSupportMultipleWindows={false}
        originWhitelist={['*']}
        injectedJavaScript={SCAN_LS}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onRequest}
        onNavigationStateChange={checkCookies}
        onLoadEnd={checkCookies}
        style={styles.web}
      />

      <TouchableOpacity
        style={[styles.doneBtn, !authed && styles.doneBtnOff]}
        onPress={() => router.back()}
        activeOpacity={0.85}
      >
        <MaterialCommunityIcons
          name={authed ? 'check-circle' : 'information-outline'}
          size={18}
          color={colors.text}
        />
        <Text style={styles.doneText}>{authed ? 'Done — Back to Slice' : 'Finish signing in first'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { padding: 6 },
  headerText: { flex: 1 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  subtitle: { color: colors.subtext, fontSize: 12, fontWeight: '600' },
  web: { flex: 1, backgroundColor: '#fff' },
  doneBtn: {
    margin: spacing.md,
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  doneBtnOff: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border },
  doneText: { color: colors.text, fontSize: 14, fontWeight: '800' },
});
