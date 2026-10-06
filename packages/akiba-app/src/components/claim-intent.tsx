import { Button, Icon, StyleSheet, Text, View, colors, fontFamily, spacing, typography } from '@/design-system';
import type { ClaimFriction, VoucherUsePlan } from '@/contracts';

const USE_PLAN_OPTIONS: { value: VoucherUsePlan; label: string }[] = [
  { value: 'nearby', label: 'Near me now' },
  { value: 'planned_visit', label: 'A planned visit' },
  { value: 'upcoming_trip', label: 'An upcoming trip' },
  { value: 'other', label: 'Other' },
];

type ClaimIntentSectionProps = {
  friction: ClaimFriction;
  intentConfirmed: boolean;
  onIntentConfirmedChange: (value: boolean) => void;
  usePlan: VoucherUsePlan | null;
  onUsePlanChange: (value: VoucherUsePlan) => void;
};

// Icon-driven selection toggle — matches the Feather/lucide-based look used
// everywhere else in this design pass, rather than a hand-drawn dot.
export function ClaimIntentSection({
  friction,
  intentConfirmed,
  onIntentConfirmedChange,
  usePlan,
  onUsePlanChange,
}: ClaimIntentSectionProps) {
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

      {friction.requiresUsePlan ? (
        <View style={styles.planGroup}>
          <Text style={styles.planPrompt}>You have an expired, unused voucher — when will you use this one?</Text>
          {USE_PLAN_OPTIONS.map((option) => (
            <Button key={option.value} style={styles.row} onPress={() => onUsePlanChange(option.value)}>
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
