import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActivityIndicator, Icon, ScrollView, colors, fontFamily } from '@/design-system';
import {
  VERIFIED_VISIT_REPORT_REASONS,
  type VerifiedVisitReportReason,
} from '@/lib/verified-visit-report-reasons';

/**
 * Reason picker for reporting a verified visit, required by Google Play's
 * user-generated content policy.
 *
 * Presentational: the caller owns the request and the access token, matching
 * how VerifiedVisitPhotoSheet is wired. Reasons are a bounded list rather
 * than a text box — free text is how personal data ends up in a moderation
 * queue, and it makes reports uncountable.
 *
 * There is no "block this member" action here on purpose: verified visits
 * carry no author identity, so there is nobody to block.
 */
export function VerifiedVisitReportSheet({
  merchantName,
  onClose,
  onSubmit,
  visible,
}: {
  merchantName: string;
  onClose: () => void;
  onSubmit: (reason: VerifiedVisitReportReason) => Promise<'reported' | 'already' | 'failed'>;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<VerifiedVisitReportReason | null>(null);
  const [result, setResult] = useState<'reported' | 'already' | 'failed' | null>(null);

  // Reset on the way out rather than from an effect watching `visible`:
  // reopening must never show the previous outcome, and every dismissal
  // goes through here, so there is no state left to stale.
  function close() {
    setPending(null);
    setResult(null);
    onClose();
  }

  async function choose(reason: VerifiedVisitReportReason) {
    if (pending) return;
    setPending(reason);
    setResult(await onSubmit(reason));
    setPending(null);
  }

  return (
    <Modal animationType="slide" onRequestClose={close} transparent visible={visible}>
      <View style={styles.scrim}>
        <Pressable accessibilityLabel="Dismiss" onPress={close} style={StyleSheet.absoluteFill} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.handle} />

          {result === 'reported' || result === 'already' ? (
            <View style={styles.done}>
              <View style={styles.doneIcon}><Icon name="check-circle" size={26} color={colors.teal} /></View>
              <Text accessibilityRole="header" style={styles.title}>Thanks for telling us</Text>
              <Text style={styles.body}>
                {/* An honest acknowledgement either way: the member's intent
                    is satisfied, and "you already reported this" should not
                    read as a rejection. */}
                {result === 'already'
                  ? 'You had already reported this visit. Our team is reviewing it.'
                  : 'Our team will review this visit. Approved photos are checked before they appear, and we re-check anything reported.'}
              </Text>
              <Pressable accessibilityRole="button" onPress={close} style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}>
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.header}>
                <Text accessibilityRole="header" style={styles.title}>Report this visit</Text>
                <Pressable accessibilityLabel="Close" onPress={close} style={styles.close}>
                  <Icon name="x" size={20} color={colors.ink} />
                </Pressable>
              </View>
              <Text style={styles.body}>
                Tell us what’s wrong with this visit at {merchantName}. Reports are anonymous.
              </Text>

              {result === 'failed' ? (
                <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
                  We couldn’t send that report. Check your connection and try again.
                </Text>
              ) : null}

              <ScrollView style={styles.reasons}>
                {VERIFIED_VISIT_REPORT_REASONS.map((reason) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ busy: pending === reason.value, disabled: Boolean(pending) }}
                    disabled={Boolean(pending)}
                    key={reason.value}
                    onPress={() => void choose(reason.value)}
                    style={({ pressed }) => [styles.reason, pressed && styles.pressed]}
                  >
                    <Text style={styles.reasonText}>{reason.label}</Text>
                    {pending === reason.value ? (
                      <ActivityIndicator color={colors.teal} size="small" />
                    ) : (
                      <Icon name="chevron-right" size={17} color={colors.muted} />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(13,14,12,0.42)', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '82%', paddingHorizontal: 20, paddingTop: 8 },
  handle: { alignSelf: 'center', backgroundColor: colors.line, borderRadius: 99, height: 4, width: 42 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, marginTop: 10 },
  title: { color: colors.ink, flex: 1, fontFamily: fontFamily.sterlingSemiBold, fontSize: 23 },
  close: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  body: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 20, marginBottom: 12 },
  error: { backgroundColor: colors.dangerTint, borderRadius: 8, color: colors.danger, fontFamily: fontFamily.sans, fontSize: 12, marginBottom: 10, padding: 10 },
  reasons: { flexGrow: 0 },
  reason: { alignItems: 'center', borderColor: colors.line, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 10, justifyContent: 'space-between', marginBottom: 8, minHeight: 52, paddingHorizontal: 15 },
  reasonText: { color: colors.ink, flex: 1, fontFamily: fontFamily.sansMedium, fontSize: 14 },
  pressed: { opacity: 0.76 },
  done: { alignItems: 'center', paddingBottom: 8, paddingTop: 18 },
  doneIcon: { alignItems: 'center', backgroundColor: colors.tint, borderRadius: 999, height: 56, justifyContent: 'center', marginBottom: 12, width: 56 },
  doneButton: { alignItems: 'center', backgroundColor: colors.teal, borderRadius: 999, justifyContent: 'center', marginTop: 14, minHeight: 48, width: '100%' },
  doneButtonText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
});
