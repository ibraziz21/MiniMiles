import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { StyleSheet } from 'react-native';

import { useAppConfig } from '@/config';
import { Text, TextButton, View, colors, fontFamily, spacing, typography } from '@/design-system';

async function openLink(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    // An in-app browser isn't always available (custom ROMs, no Chrome
    // Custom Tabs provider). Falling back to the system browser is what
    // keeps the policy actually reachable rather than silently dead.
    await Linking.openURL(url).catch(() => null);
  }
}

/**
 * Terms and Privacy, shown before an account can be created
 * (AKIBA-MOB-001 §2). The URLs are whatever `/api/v1/config` returns —
 * never hardcoded — so legal can move the pages without an app release.
 *
 * Rendered as two full-size buttons rather than links inside a sentence so
 * both clear the 44pt/48dp target.
 */
export function LegalLinksNotice({ intro }: { intro?: string }) {
  const { legal } = useAppConfig();

  return (
    <View style={styles.block}>
      <Text style={styles.intro}>
        {intro ?? 'By continuing, you agree to the Akiba Terms of Use and Privacy Policy.'}
      </Text>
      <View style={styles.row}>
        <TextButton
          accessibilityHint="Opens the Akiba Terms of Use"
          label="Terms of Use"
          onPress={() => void openLink(legal.termsUrl)}
        />
        <Text style={styles.separator}>·</Text>
        <TextButton
          accessibilityHint="Opens the Akiba Privacy Policy"
          label="Privacy Policy"
          onPress={() => void openLink(legal.privacyUrl)}
        />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
  },
  intro: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
    lineHeight: 18,
    textAlign: 'center',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  separator: {
    color: colors.line,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
  },
});
