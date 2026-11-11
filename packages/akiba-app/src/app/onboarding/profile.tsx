// Onboarding step 1 of 4 (AKIBA-MOB-001 §3.2, BDR-007). Writes straight to the existing
// PATCH /api/v1/me/settings — the same route the Settings screen edits
// through — so a field set here shows up there, and §4's "profile fields
// saved during onboarding must not be requested again" holds because the
// next entry into onboarding reads `username` back from bootstrap.
//
// Country is fixed to Kenya: that's the only market Akiba is live in,
// and it's sent as the display name "Kenya" because that's what the web
// profile editor writes (hub-page's isSupportedCountryInput accepts either
// form, but the stored values should match).
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ApiRequestError, createApiClient } from '@/api';
import { useAuth } from '@/auth';
import { OnboardingStepScreen } from '@/components/onboarding-step';
import { useMember } from '@/member';
import { ONBOARDING_ROUTES } from '@/onboarding';
import { FormField, Icon, Text, View, colors, fontFamily, spacing, typography } from '@/design-system';

const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;
const COUNTRY = 'Kenya';
// Tiles rather than free text so the common answers are spelled one way.
// "Other" opens a text field for everywhere else.
const OTHER = 'Other';
const CITIES = ['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', OTHER] as const;

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
  const [city, setCity] = useState<(typeof CITIES)[number] | null>(null);
  const [otherCity, setOtherCity] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Coming back to this step (Back from location, or a resume) remounts it,
  // and bootstrap carries the username but not the city — so read the saved
  // city from settings rather than making the member pick it again. Only
  // fills in when nothing has been picked yet, so a slow response can't
  // overwrite a choice made meanwhile.
  const hasSavedProfile = !!existing?.username;
  useEffect(() => {
    if (!hasSavedProfile || !accessToken) return;
    let active = true;
    void createApiClient({ accessToken })
      .getSettings()
      .then(({ profile }) => {
        const saved = profile.city?.trim();
        if (!active || !saved) return;
        const known = CITIES.find((option) => option !== OTHER && option.toLowerCase() === saved.toLowerCase());
        setCity((current) => current ?? known ?? OTHER);
        if (!known) setOtherCity((current) => current || saved);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [accessToken, hasSavedProfile]);

  const cityValue = city === OTHER ? otherCity.trim() : (city ?? '');

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
        city: cityValue,
      });
      // Re-read bootstrap so `user.username` is current: it's what the
      // resume resolver uses to decide this step is done.
      reload();
      router.push(ONBOARDING_ROUTES.location);
    } catch (error) {
      setSaveError(saveErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingStepScreen
      body="Pick a username and your city."
      error={saveError}
      layout="form"
      onPrimary={() => void save()}
      primaryBusy={saving}
      primaryBusyLabel="Saving…"
      primaryDisabled={!cityValue}
      primaryLabel="Continue"
      step="profile"
      title="Set up your profile">
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
        returnKeyType="done"
        style={styles.input}
        value={username}
      />

      <View style={styles.field}>
        <Text style={styles.label}>Country</Text>
        <View accessibilityLabel="Country: Kenya. Akiba is only available in Kenya for now." accessible style={styles.fixed}>
          <Text style={styles.fixedValue}>🇰🇪  {COUNTRY}</Text>
          <Icon name="lock" size={16} color={colors.muted} />
        </View>
        <Text style={styles.hint}>Akiba is live in Kenya for now.</Text>
      </View>

      <View style={styles.field}>
        <Text nativeID="city-label" style={styles.label}>
          Your city
        </Text>
        <View accessibilityLabelledBy="city-label" accessibilityRole="radiogroup" style={styles.tiles}>
          {CITIES.map((option) => {
            const selected = city === option;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={option}
                onPress={() => {
                  setCity(option);
                  if (saveError) setSaveError(null);
                }}
                style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && styles.tilePressed]}>
                <Icon
                  name={option === OTHER ? 'more-horizontal' : selected ? 'map-pin' : 'compass'}
                  size={16}
                  color={selected ? colors.white : colors.muted}
                />
                <Text style={[styles.tileLabel, selected && styles.tileLabelSelected]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>
        {city === OTHER ? (
          <FormField
            autoCapitalize="words"
            autoComplete="off"
            autoFocus
            label="Which city?"
            onChangeText={setOtherCity}
            onSubmitEditing={() => void save()}
            placeholder="e.g. Thika"
            returnKeyType="done"
            style={styles.input}
            value={otherCity}
          />
        ) : null}
      </View>
    </OnboardingStepScreen>
  );
}

const styles = StyleSheet.create({
  input: {
    borderRadius: 14,
    minHeight: 56,
  },
  field: {
    gap: spacing.sm,
  },
  label: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.small,
  },
  fixed: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
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
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '30%',
    flexGrow: 1,
    gap: 4,
    justifyContent: 'center',
    minHeight: 64,
    paddingVertical: spacing.sm,
  },
  tileSelected: {
    backgroundColor: colors.tealDark,
    borderColor: colors.tealDark,
  },
  tilePressed: {
    opacity: 0.7,
  },
  tileLabel: {
    color: colors.ink,
    fontFamily: fontFamily.sansSemiBold,
    fontSize: typography.small,
  },
  tileLabelSelected: {
    color: colors.white,
  },
});
