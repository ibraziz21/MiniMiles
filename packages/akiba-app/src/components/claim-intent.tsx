import { Button, Icon, StyleSheet, Text, View, colors, fontFamily, spacing, typography } from '@/design-system';
import type { ClaimFriction, VoucherUsePlan } from '@/contracts';

const USE_PLAN_OPTIONS: { value: VoucherUsePlan; label: string }[] = [
  { value: 'nearby', label: 'Near me now' },
  { value: 'upcoming_trip', label: 'An upcoming trip' },
  { value: 'other', label: 'Other' },
];

type ClaimIntentSectionProps = {
  sheet?: boolean;
  friction?: ClaimFriction;
  intentConfirmed: boolean;
  onIntentConfirmedChange: (value: boolean) => void;
  usePlan?: VoucherUsePlan | null;
  onUsePlanChange?: (value: VoucherUsePlan) => void;
};

// Icon-driven selection toggle — matches the Feather/lucide-based look used
// everywhere else in this design pass, rather than a hand-drawn dot.
export function ClaimIntentSection({
  sheet = false,
  friction,
  intentConfirmed,
  onIntentConfirmedChange,
  usePlan,
  onUsePlanChange,
}: ClaimIntentSectionProps) {
  if (sheet) {
    return (
      <View style={styles.section}>
        <Button accessibilityRole="checkbox" accessibilityState={{ checked: intentConfirmed }} style={[styles.row, styles.sheetCheckbox]} onPress={() => onIntentConfirmedChange(!intentConfirmed)}>
          <Icon name={intentConfirmed ? 'check-square' : 'square'} size={19} color={colors.tealDark} />
          <Text style={styles.sheetCheckboxLabel}>I intend to use this voucher before it expires.</Text>
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Button style={styles.row} onPress={() => onIntentConfirmedChange(!intentConfirmed)}>
        <Icon
          name={intentConfirmed ? 'check-circle' : 'circle'}
          size={20}
          color={intentConfirmed ? colors.teal : colors.line}
        />
        <Text style={styles.rowLabel}>I intend to use this voucher before it expires</Text>
      </Button>

      {friction?.requiresUsePlan ? (
        <View style={styles.planGroup}>
          <Text style={styles.planPrompt}>You have an expired, unused voucher — when will you use this one?</Text>
          {USE_PLAN_OPTIONS.map((option) => (
            <Button key={option.value} style={styles.row} onPress={() => onUsePlanChange?.(option.value)}>
              <Icon
                name={usePlan === option.value ? 'check-circle' : 'circle'}
                size={20}
                color={usePlan === option.value ? colors.teal : colors.line}
              />
              <Text style={styles.rowLabel}>{option.label}</Text>
            </Button>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sheetCheckbox: { minHeight: 44, backgroundColor: colors.tint, padding: 11, borderRadius: 12 },
  sheetCheckboxLabel: { flex: 1, flexShrink: 1, color: colors.ink, fontFamily: fontFamily.sans, fontSize: 14 },
  section: {
    gap: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowLabel: {
    color: colors.ink,
    flex: 1,
    flexShrink: 1,
    fontFamily: fontFamily.sans,
    fontSize: typography.body,
  },
  planGroup: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  planPrompt: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
  },
});
