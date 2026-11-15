import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, PrimaryButton, colors, fontFamily } from '@/design-system';

/**
 * The "leave a recommendation" ask on a merchant page, for a member with an
 * open discovery contribution request there (a verified in-store visit).
 *
 * It used to live only inside the Verified tab, but a merchant with any
 * offers opens on Vouchers, so most members never saw it. The card now sits
 * above the tabs, and the first time a member opens the page with a request
 * open it is also offered as a sheet — once per merchant per request window,
 * so it doesn't nag on every visit to the page.
 */

// Matches the server's per-merchant request cooldown
// (create_discovery_contribution_request, 14 days): a new request can't
// open sooner, so neither does a new sheet.
const PROMPT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

function promptKey(userId: string, merchantSlug: string): string {
  return `akiba.contribution.prompted.${`${userId}.${merchantSlug}`.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** True once, the first time this member lands here with a request open. */
export function useContributionSheet(userId: string | null, merchantSlug: string, eligible: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!eligible || !userId) return;
    let active = true;
    const key = promptKey(userId, merchantSlug);
    void (async () => {
      try {
        const last = Number(await SecureStore.getItemAsync(key));
        if (Number.isFinite(last) && Date.now() - last < PROMPT_COOLDOWN_MS) return;
        await SecureStore.setItemAsync(key, String(Date.now()));
      } catch {
        // No keystore: still ask, just without remembering — the card
        // remains the way back to the form either way.
      }
      if (active) setOpen(true);
    })();
    return () => {
      active = false;
    };
  }, [eligible, merchantSlug, userId]);

  return { open, close: () => setOpen(false) };
}

export function ContributionCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityHint="Opens the recommendation form"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.roundIcon}>
        <Icon name="message-square" size={20} color={colors.teal} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.cardTitle}>Your Akiba visit is verified</Text>
        <Text style={styles.cardBody}>Recommend what you tried and help others find this place.</Text>
      </View>
      <View style={styles.action}>
        <Text style={styles.actionText}>Recommend</Text>
        <Icon name="chevron-right" size={16} color={colors.white} />
      </View>
    </Pressable>
  );
}

export function ContributionSheet({
  merchantName,
  visible,
  onRecommend,
  onClose,
}: {
  merchantName: string;
  visible: boolean;
  onRecommend: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.scrim}>
        <Pressable onPress={() => undefined} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.sheetIcon}>
            <Icon name="message-square" size={26} color={colors.teal} />
          </View>
          <Text accessibilityRole="header" style={styles.sheetTitle}>{`How was ${merchantName}?`}</Text>
          <Text style={styles.sheetBody}>
            Your visit is verified. Share what you tried and what you’d recommend — it helps other Akiba members find good places.
          </Text>
          <PrimaryButton
            label="Leave a recommendation"
            onPress={() => {
              onClose();
              onRecommend();
            }}
            style={styles.sheetButton}
          />
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.later}>
            <Text style={styles.laterText}>Maybe later</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  card: {
    alignItems: 'center',
    backgroundColor: colors.tint,
    borderColor: 'rgba(35,141,157,0.20)',
    borderCurve: 'continuous',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
  },
  roundIcon: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  cardTitle: { color: colors.ink, fontFamily: fontFamily.sansBold, fontSize: 15 },
  cardBody: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 18, marginTop: 2 },
  action: {
    alignItems: 'center',
    backgroundColor: colors.tealDark,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 2,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 8,
  },
  actionText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  scrim: { backgroundColor: 'rgba(8,12,15,0.40)', flex: 1, justifyContent: 'flex-end' },
  sheet: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: { backgroundColor: colors.line, borderRadius: 2, height: 4, marginBottom: 20, width: 40 },
  sheetIcon: {
    alignItems: 'center',
    backgroundColor: colors.tint,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  sheetTitle: {
    color: colors.ink,
    fontFamily: fontFamily.sansBold,
    fontSize: 22,
    marginTop: 14,
    textAlign: 'center',
  },
  sheetBody: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    textAlign: 'center',
  },
  sheetButton: { alignSelf: 'stretch', marginTop: 20, minHeight: 52 },
  later: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 4 },
  laterText: { color: colors.muted, fontFamily: fontFamily.sansSemiBold, fontSize: 15 },
});
