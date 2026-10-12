import * as Linking from 'expo-linking';
import { Platform, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ActivityIndicator,
  Icon,
  PrimaryButton,
  ScrollView,
  Text,
  View,
  colors,
  fontFamily,
  spacing,
  typography,
} from '@/design-system';
import type { MobileConfig } from '@/contracts';

/**
 * The four states a cold start can stop in before any tab renders
 * (AKIBA-MOB-001 §1). All four are plain, unanimated, scrollable layouts:
 * scrollable so the largest system text size can't clip the message, and
 * unanimated so nothing here depends on motion being available.
 */

function LaunchShell({
  children,
  label,
}: {
  children: React.ReactNode;
  /** Announced when the screen takes focus, so the state is never visual-only. */
  label: string;
}) {
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.shell}>
      <ScrollView
        accessibilityLabel={label}
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}>
        <View style={styles.content}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function LaunchLoadingScreen({ message = 'Loading Akiba Pass…' }: { message?: string }) {
  return (
    <LaunchShell label={message}>
      <ActivityIndicator accessibilityLabel={message} color={colors.teal} size="large" />
      <Text style={styles.body}>{message}</Text>
    </LaunchShell>
  );
}

export function MaintenanceScreen() {
  return (
    <LaunchShell label="Akiba Pass is under maintenance">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.glyph}>
        <Icon color={colors.tealDark} name="tool" size={28} />
      </View>
      <Text style={styles.title}>We&apos;ll be right back</Text>
      <Text style={styles.body}>
        Akiba Pass is down for scheduled maintenance. Your Miles and vouchers are safe — please try again
        shortly.
      </Text>
    </LaunchShell>
  );
}

export function UpgradeRequiredScreen({ config }: { config: MobileConfig }) {
  const storeUrl = Platform.OS === 'ios' ? config.storeUrl.ios : config.storeUrl.android;
  const storeName = Platform.OS === 'ios' ? 'the App Store' : 'Google Play';

  return (
    <LaunchShell label="Update required">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.glyph}>
        <Icon color={colors.tealDark} name="download" size={28} />
      </View>
      <Text style={styles.title}>Update Akiba Pass</Text>
      <Text style={styles.body}>
        This version is no longer supported. Update to the latest version to keep earning and using your
        rewards.
      </Text>
      {storeUrl ? (
        <PrimaryButton
          accessibilityHint={`Opens ${storeName}`}
          label="Update Akiba Pass"
          onPress={() => {
            Linking.openURL(storeUrl).catch(() => null);
          }}
          style={styles.action}
        />
      ) : (
        // No store listing is published for this platform yet, so there is
        // nothing to open — say where to go instead of offering a button
        // that would do nothing.
        <Text style={styles.body}>Open {storeName} and update Akiba Pass to continue.</Text>
      )}
    </LaunchShell>
  );
}

export function ConnectionErrorScreen({
  onRetry,
  retrying = false,
  title = 'No connection',
  message = 'We couldn’t reach Akiba. Check your connection and try again.',
}: {
  onRetry: () => void;
  retrying?: boolean;
  title?: string;
  message?: string;
}) {
  return (
    <LaunchShell label={`${title}. ${message}`}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.glyph}>
        <Icon color={colors.tealDark} name="wifi-off" size={28} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.body}>
        {message}
      </Text>
      <PrimaryButton busy={retrying} busyLabel="Trying again…" label="Try again" onPress={onRetry} style={styles.action} />
    </LaunchShell>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.paper,
    flex: 1,
  },
  scroll: {
    backgroundColor: colors.paper,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  content: {
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.md,
    maxWidth: 420,
    width: '100%',
  },
  glyph: {
    alignItems: 'center',
    backgroundColor: colors.tint,
    borderCurve: 'continuous',
    borderRadius: 20,
    height: 60,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    width: 60,
  },
  title: {
    color: colors.ink,
    fontFamily: fontFamily.sterlingSemiBold,
    fontSize: typography.title,
    textAlign: 'center',
  },
  body: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.body,
    lineHeight: 24,
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.sm,
    minWidth: 220,
  },
});
