// Onboarding step 2 (AKIBA-MOB-001 §3.2). Writes straight to the existing
// PATCH /api/v1/me/settings — the same route the Settings screen edits
// through — so a field set here shows up there, and §4's "profile fields
// saved during onboarding must not be requested again" holds because the
// next entry into onboarding reads `username` back from bootstrap.
//
// Country is fixed to Kenya: that's the only market Akiba Pass is live in,
// and it's sent as the display name "Kenya" because that's what the web
// profile editor writes (hub-page's isSupportedCountryInput accepts either
// form, but the stored values should match).
import { useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import { ApiRequestError, createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { OnboardingStepScreen } from '@/components/onboarding-step';
import { useMember } from '@/member';
import { ONBOARDING_ROUTES } from '@/onboarding';
import {
  FormField,
  Text,
  View,
  colors,
  fontFamily,
  radius,
  spacing,
  typography,
} from '@/design-system';

const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;
const COUNTRY = 'Kenya';

function usernameError(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'Choose a username so merchants and leaderboards can show you.';
  if (!USERNAME_RULE.test(normalized)) return 'Use 3–20 lowercase letters, numbers or underscores.';
  return null;
}

/** The server's own mapped message when it has one — never a raw error. */
function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.body && typeof error.body === 'object' && 'error' in error.body) {
    const message = (error.body as { error?: { message?: string } }).error?.message;
    if (message) return message;
  }
  return 'We couldn’t save your profile. Check your connection and try again.';
}

export default function OnboardingProfileScreen() {
  const { accessToken } = useAuth();
  const { state, reload } = useMember();
  const existing = state.status === 'ready' ? state.bootstrap.user : null;

  const [username, setUsername] = useState(existing?.username ?? '');
  const [city, setCity] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const invalid = usernameError(username);
    if (invalid) {
      setFieldError(invalid);
      return;
    }
    if (!accessToken) {
      setSaveError('Your session expired. Sign in again to continue.');
      return;
    }

    setFieldError(null);
    setSaveError(null);
    setSaving(true);

    try {
      await createApiClient({ accessToken }).updateSettings({
        username: username.trim().toLowerCase(),
        country: COUNTRY,
        city: city.trim(),
      });
      // Re-read bootstrap so `user.username` is current: it's what the
      // resume resolver uses to decide this step is done.
      reload();
      router.push(ONBOARDING_ROUTES.pass);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingStepScreen
      error={saveError}
      intro="Your username is how you appear across Akiba. Your city stays private — it only shapes which merchants we show you first."
      onPrimary={() => void save()}
      primaryBusy={saving}
      primaryBusyLabel="Saving…"
      primaryLabel="Continue"
      step="profile"
      title="Set up your profile">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.form}>
        <FormField
          autoCapitalize="none"
          autoComplete="username"
          autoCorrect={false}
          error={fieldError}
          hint="3–20 lowercase letters, numbers or underscores."
          label="Username"
          maxLength={20}
          onChangeText={(value) => {
            setUsername(value);
            if (fieldError) setFieldError(null);
            if (saveError) setSaveError(null);
          }}
          placeholder="e.g. wanjiku_k"
          returnKeyType="next"
          value={username}
        />

        <View style={styles.field}>
          <Text style={styles.label}>Country</Text>
          <View accessibilityLabel="Country: Kenya. Akiba Pass is only available in Kenya for now." accessible style={styles.fixed}>
            <Text style={styles.fixedValue}>{COUNTRY}</Text>
          </View>
          <Text style={styles.hint}>Akiba Pass is live in Kenya for now.</Text>
        </View>

        <FormField
          autoCapitalize="words"
          autoComplete="off"
          hint="Optional. Helps us put nearby merchants first."
          label="City"
          onChangeText={setCity}
          onSubmitEditing={() => void save()}
          placeholder="e.g. Nairobi"
          returnKeyType="done"
          value={city}
        />
      </KeyboardAvoidingView>
    </OnboardingStepScreen>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.small,
  },
  fixed: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  fixedValue: {
    color: colors.ink,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.body,
  },
  hint: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
  },
});
