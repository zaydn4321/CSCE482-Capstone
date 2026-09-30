import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { nativePalette } from '@/constants/colors';
import { useLocation } from '@/context/LocationContext';
import { beginTimelinePicker, endTimelinePicker, releasePendingTimelineFile, trackPendingTimelineFile } from '@/services/locationStore';

const MAX_TIMELINE_FILE_BYTES = 25 * 1024 * 1024;

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function GoogleTimelineImportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, importTimeline, removeImport } = useLocation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const web = Platform.OS === 'web';

  const pickTimeline = async () => {
    if (web || busy) return;
    setMessage(null);
    setBusy(true);
    let pickedUri: string | null = null;
    const pickerSessionId = `picker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    let pickerSessionStarted = false;
    let outcome: { kind: 'success' | 'error'; text: string } | null = null;
    try {
      await beginTimelinePicker(pickerSessionId);
      pickerSessionStarted = true;
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'public.json'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      pickedUri = asset.uri;
      await trackPendingTimelineFile(asset.uri);
      if (!asset.name.toLowerCase().endsWith('.json')) {
        throw new Error('Choose a Google Timeline .json file.');
      }
      const file = new File(asset.uri);
      const fileSize = asset.size || file.size;
      if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) {
        throw new Error('The file size could not be determined or the file is empty. Choose a non-empty Google Timeline JSON file with a known size.');
      }
      if (fileSize > MAX_TIMELINE_FILE_BYTES) {
        throw new Error('This file is larger than the 25 MB import limit. Export a smaller Timeline JSON file and try again.');
      }
      const content = await file.text();
      const imported = await importTimeline(content, asset.name);
      outcome = {
        kind: 'success',
        text: `${imported.filename} added — ${imported.pointCount.toLocaleString()} location points are now part of your history.`,
      };
    } catch (error) {
      outcome = {
        kind: 'error',
        text: error instanceof Error ? error.message : 'The selected file could not be imported.',
      };
    } finally {
      if (pickedUri) {
        try {
          await releasePendingTimelineFile(pickedUri);
        } catch (error) {
          const cleanupMessage = error instanceof Error ? error.message : 'The temporary picked-file copy could not be removed.';
          outcome = {
            kind: 'error',
            text: `${outcome?.text ?? 'The Timeline import did not complete.'} Temporary-file cleanup failed; Delete My Location History can retry cleanup. ${cleanupMessage}`,
          };
        }
      }
      if (pickerSessionStarted) {
        try {
          await endTimelinePicker(pickerSessionId);
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'The picker session could not be closed.';
          outcome = {
            kind: 'error',
            text: `${outcome?.text ?? 'The Timeline import did not complete.'} ${detail}`,
          };
        }
      }
      if (outcome) setMessage(outcome);
      setBusy(false);
    }
  };

  const confirmRemove = (id: string, filename: string) => {
    Alert.alert(
      'Remove imported file?',
      `Remove ${filename} and its imported locations from this device? Recorded GPS points and names for places still in your history will stay. Names attached only to this file will be removed.`,
      [
        { text: 'Keep file', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeImport(id)
              .then(() => setMessage({ kind: 'success', text: `${filename} and its imported locations were removed.` }))
              .catch(error => setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The imported file could not be removed.' }));
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: web ? 67 : insets.top + 12,
            paddingBottom: web ? 34 : Math.max(insets.bottom, 20),
          },
        ]}
      >
        <View style={[styles.topbar, { borderBottomColor: colors.border }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID="button-import-back"
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back" size={21} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.brand, { color: colors.foreground }]}>location wrapped<Text style={{ color: colors.lime }}>.</Text></Text>
          <Text style={[styles.topTag, { color: colors.lime }]}>DEVICE ONLY</Text>
        </View>

        <View style={styles.intro}>
          <Text style={[styles.kicker, { color: colors.lime }]}>YOUR HISTORY, YOURS</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>Bring your{'\n'}Timeline in.</Text>
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            Add a Google Timeline export to your Wrapped. Your file and locations stay on this device — nothing is uploaded.
          </Text>
        </View>

        <View style={[styles.privacyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.privacyIcon, { backgroundColor: nativePalette.success }]}>
            <Ionicons name="lock-closed-outline" size={19} color={colors.lime} />
          </View>
          <View style={styles.privacyCopy}>
            <Text style={[styles.privacyTitle, { color: colors.foreground }]}>Private by design</Text>
            <Text style={[styles.privacyBody, { color: colors.mutedForeground }]}>
              Imports are stored locally beside your history. Your existing GPS points and personal place names are not replaced.
            </Text>
          </View>
        </View>

        {web ? (
          <View style={[styles.webNotice, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
            <Ionicons name="phone-portrait-outline" size={20} color={colors.lime} />
            <Text style={[styles.webNoticeText, { color: colors.foreground }]}>
              Import is disabled in the browser preview. Open Location Wrapped on iOS or Android to add a Timeline file privately on your device.
            </Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            testID="button-pick-timeline"
            disabled={busy}
            onPress={() => void pickTimeline()}
            style={({ pressed }) => [
              styles.pickButton,
              { backgroundColor: colors.lime },
              pressed && !busy && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            {busy ? <ActivityIndicator color={colors.background} /> : <Ionicons name="document-text-outline" size={20} color={colors.background} />}
            <Text style={[styles.pickButtonText, { color: colors.background }]}>{busy ? 'Reading Timeline…' : 'Choose Google Timeline JSON'}</Text>
            {!busy ? <Ionicons name="arrow-forward" size={18} color={colors.background} /> : null}
          </Pressable>
        )}
        <Text style={[styles.supported, { color: nativePalette.foregroundSubtle }]}>
          Supports Android and iOS Timeline exports, plus legacy Google Takeout Records.json. Files must be 25 MB or smaller.
        </Text>

        {message ? (
          <View
            accessibilityLiveRegion="polite"
            testID={message.kind === 'success' ? 'import-success' : 'import-error'}
            style={[
              styles.message,
              { backgroundColor: message.kind === 'success' ? nativePalette.success : nativePalette.alert },
            ]}
          >
            <Ionicons
              name={message.kind === 'success' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
              size={19}
              color={message.kind === 'success' ? nativePalette.successText : nativePalette.foregroundError}
            />
            <Text style={[styles.messageText, { color: message.kind === 'success' ? nativePalette.successText : nativePalette.foregroundError }]}>{message.text}</Text>
          </View>
        ) : null}

        <View style={styles.importSection}>
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Imported files</Text>
            <Text style={[styles.count, { color: nativePalette.foregroundSubtle }]}>{state.imports.length}</Text>
          </View>
          {state.imports.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="time-outline" size={20} color={nativePalette.foregroundSubtle} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Your imported Timeline files will appear here.</Text>
            </View>
          ) : state.imports.map(item => (
            <View key={item.id} style={[styles.importRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.fileIcon, { backgroundColor: colors.secondary }]}>
                <Ionicons name="document-text-outline" size={18} color={colors.lime} />
              </View>
              <View style={styles.fileMeta}>
                <Text numberOfLines={1} style={[styles.filename, { color: colors.foreground }]}>{item.filename}</Text>
                <Text style={[styles.fileDetails, { color: nativePalette.foregroundSubtle }]}>
                  {item.pointCount.toLocaleString()} points · Added {formatDate(item.importedAt)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.filename}`}
                testID={`button-remove-import-${item.id}`}
                disabled={busy}
                onPress={() => confirmRemove(item.id, item.filename)}
                hitSlop={10}
                style={({ pressed }) => [styles.removeButton, busy && styles.disabled, pressed && !busy && styles.pressed]}
              >
                <Ionicons name="trash-outline" size={18} color={nativePalette.foregroundMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 22, maxWidth: 700, width: '100%', alignSelf: 'center' },
  topbar: { minHeight: 46, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  backButton: { width: 38, height: 38, alignItems: 'flex-start', justifyContent: 'center' },
  brand: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, letterSpacing: -0.7 },
  topTag: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.6 },
  intro: { paddingTop: 37, paddingBottom: 26 },
  kicker: { fontFamily: 'Inter_500Medium', fontSize: 10, letterSpacing: 2.1, marginBottom: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 45, lineHeight: 47, letterSpacing: -3.3 },
  description: { fontFamily: 'Inter_400Regular', marginTop: 16, fontSize: 15, lineHeight: 23, maxWidth: 475 },
  privacyCard: { flexDirection: 'row', gap: 14, borderWidth: 1, borderRadius: 16, padding: 17, marginBottom: 22 },
  privacyIcon: { width: 37, height: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  privacyCopy: { flex: 1 },
  privacyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 5 },
  privacyBody: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  pickButton: { minHeight: 54, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 17, gap: 10 },
  pickButtonText: { fontFamily: 'Inter_700Bold', fontSize: 14, flex: 1, textAlign: 'center' },
  disabled: { opacity: 0.7 },
  pressed: { opacity: 0.8 },
  supported: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 11, textAlign: 'center' },
  webNotice: { borderWidth: 1, borderRadius: 12, padding: 17, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  webNoticeText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  message: { borderRadius: 12, marginTop: 16, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  messageText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18 },
  importSection: { marginTop: 35 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 11 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 19, letterSpacing: -0.5 },
  count: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  emptyCard: { minHeight: 72, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, flex: 1 },
  importRow: { minHeight: 75, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  fileIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  fileMeta: { flex: 1 },
  filename: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 5 },
  fileDetails: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  removeButton: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
});