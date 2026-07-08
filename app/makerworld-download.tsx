import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { colors, spacing } from '../constants/theme';
import { setMwDownload } from '../services/mwBus';

// Interactive MakerWorld download. Headless API requests hit a GeeTest CAPTCHA
// (HTTP 418 "confirm you are not a robot"). The only reliable path is the real
// page: the user taps the site's Download button and solves the CAPTCHA if
// shown. We hook fetch/XHR inside the page so when it fetches the signed 3MF
// URL (post-CAPTCHA), we grab it and download it — mirroring the reference app's
// WebView DownloadListener flow.

const UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// Patches fetch/XHR/window.open + anchor clicks before the SPA loads, so any way
// the page delivers the 3MF (JSON {url}, direct .3mf link, or a blob) gets
// reported back. This is what lets us intercept the download the moment the user
// taps the page's Download button (and passes the GeeTest check).
const HOOK = `(function(){
  if (window.__mwHook) return; window.__mwHook = true;
  function report(o){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }catch(e){} }
  function file(url,name){ if(url) report({t:'file',url:url,name:name||''}); }
  function scan(u,text){
    if (typeof u==='string' && u.indexOf('/f3mf')>-1){
      try { var j=JSON.parse(text); if(j&&j.url) file(j.url, j.name); } catch(e){}
    }
  }
  var of = window.fetch;
  window.fetch = function(){
    var args = arguments;
    var u = (args[0] && args[0].url) ? args[0].url : args[0];
    return of.apply(this,args).then(function(resp){
      try { resp.clone().text().then(function(t){ scan(u,t); }); } catch(e){}
      return resp;
    });
  };
  var oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(m,u){ this.__u=u; return oo.apply(this,arguments); };
  XMLHttpRequest.prototype.send = function(){
    var x=this;
    x.addEventListener('load', function(){ try{ scan(x.__u, x.responseText); }catch(e){} });
    return os.apply(this,arguments);
  };
  var ow = window.open;
  window.open = function(u){ if (u && /\\.(3mf|stl)(\\?|$)/i.test(u)) { file(u, u.split('?')[0].split('/').pop()); return null; } return ow.apply(this, arguments); };
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.href || '';
    if (href.indexOf('blob:') === 0) {
      e.preventDefault();
      fetch(href).then(function(r){ return r.blob(); }).then(function(b){
        var fr = new FileReader();
        fr.onload = function(){ report({ t:'blob', data:String(fr.result), name:(a.getAttribute('download')||'model.3mf') }); };
        fr.readAsDataURL(b);
      }).catch(function(err){ report({ t:'err', msg:String(err) }); });
    } else if (/\\.(3mf|stl)(\\?|$)/i.test(href)) {
      file(href, a.getAttribute('download') || href.split('?')[0].split('/').pop());
    }
  }, true);
})(); true;`;

type Phase = 'browsing' | 'downloading' | 'done' | 'error';

export default function MakerWorldDownloadScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ designId?: string; instanceId?: string }>();
  const designId = params.designId || '';
  const instanceId = params.instanceId || '';
  // Build the model URL from clean ids (raw URL params with ?/# break routing).
  const startUrl = designId
    ? `https://makerworld.com/en/models/${designId}${instanceId ? `#profileId-${instanceId}` : ''}`
    : 'https://makerworld.com/en';

  const [phase, setPhase] = useState<Phase>('browsing');
  const [msg, setMsg] = useState('Tap the model’s Download button. Solve the CAPTCHA if it appears.');
  const grabbed = useRef(false);

  const grab = useCallback(
    async (fileUrl: string, name: string) => {
      if (grabbed.current) return;
      grabbed.current = true;
      setPhase('downloading');
      setMsg('Got the file URL — downloading…');
      try {
        const fileName = name || `makerworld_${designId || 'model'}.3mf`;
        const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
        const targetUri = `${baseDir}makerworld_${designId || Date.now()}.3mf`;
        await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => {});
        const file = await FileSystem.downloadAsync(fileUrl, targetUri);
        const info = await FileSystem.getInfoAsync(file.uri);
        if (!info.exists || !info.size) throw new Error('Downloaded file is empty.');
        setMwDownload({
          designId,
          instanceId,
          fileName,
          filePath: file.uri.replace(/^file:\/\//, ''),
          sizeBytes: info.size,
        });
        setPhase('done');
        setMsg('Downloaded. Returning to Slice…');
        setTimeout(() => router.back(), 600);
      } catch (error) {
        grabbed.current = false;
        setPhase('error');
        setMsg(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [designId, instanceId, router]
  );

  const grabBlob = useCallback(
    async (dataUrl: string, name: string) => {
      if (grabbed.current) return;
      grabbed.current = true;
      setPhase('downloading');
      setMsg('Saving downloaded file…');
      try {
        const b64 = dataUrl.split(',')[1] ?? '';
        if (!b64) throw new Error('Empty blob');
        const baseDir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
        const targetUri = `${baseDir}makerworld_${designId || Date.now()}.3mf`;
        await FileSystem.writeAsStringAsync(targetUri, b64, { encoding: 'base64' });
        const info = await FileSystem.getInfoAsync(targetUri);
        if (!info.exists || !info.size) throw new Error('Saved file is empty.');
        setMwDownload({
          designId,
          instanceId,
          fileName: name || `makerworld_${designId || 'model'}.3mf`,
          filePath: targetUri.replace(/^file:\/\//, ''),
          sizeBytes: info.size,
        });
        setPhase('done');
        setMsg('Downloaded. Returning to Slice…');
        setTimeout(() => router.back(), 600);
      } catch (error) {
        grabbed.current = false;
        setPhase('error');
        setMsg(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [designId, instanceId, router]
  );

  const onMessage = useCallback(
    (e: { nativeEvent: { data: string } }) => {
      try {
        const m = JSON.parse(e.nativeEvent.data);
        if (m.t === 'file' && m.url) grab(m.url, m.name);
        else if (m.t === 'blob' && m.data) grabBlob(m.data, m.name);
      } catch {
        // ignore
      }
    },
    [grab, grabBlob]
  );

  // Catch direct navigations to a model file (some flows redirect to the CDN).
  const onRequest = useCallback(
    (req: WebViewNavigation): boolean => {
      if (/\.(3mf|stl)(\?|$)/i.test(req.url)) {
        grab(req.url, req.url.split('?')[0].split('/').pop() || '');
        return false;
      }
      return true;
    },
    [grab]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={10}>
          <MaterialCommunityIcons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Download from MakerWorld</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {msg}
          </Text>
        </View>
        {phase === 'downloading' ? <ActivityIndicator color={colors.primary} /> : null}
      </View>

      <View style={styles.banner}>
        <MaterialCommunityIcons name="gesture-tap" size={18} color={colors.primary} />
        <Text style={styles.bannerText}>
          Scroll to the model’s <Text style={styles.bannerStrong}>Download</Text> button and tap it. Solve the puzzle if
          one appears — the file grabs automatically.
        </Text>
      </View>

      <WebView
        source={{ uri: startUrl }}
        userAgent={UA}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={HOOK}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onRequest}
        style={styles.web}
      />
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
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  subtitle: { color: colors.subtext, fontSize: 12, fontWeight: '600' },
  web: { flex: 1, backgroundColor: '#fff' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bannerText: { flex: 1, color: colors.subtext, fontSize: 12, fontWeight: '600' },
  bannerStrong: { color: colors.text, fontWeight: '800' },
});
