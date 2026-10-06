import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from 'react';
import type { Feather } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Button } from './button';
import { Icon } from './icon';
import { IconChip } from './icon-chip';
import { Text } from './text';
import { colors, fontFamily, radius, spacing, typography } from './tokens';

// Groups ListRows into hub-page's SettingsSection container — a single
// bordered, rounded card with a hairline divider between rows, rather than
// each row floating as its own separate card.
export function ListGroup({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <Fragment key={row.key ?? index}>
          {index > 0 ? <View style={styles.divider} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

type FeatherName = ComponentProps<typeof Feather>['name'];

type ListRowProps = {
  icon: FeatherName;
  label: string;
  description?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  variant?: 'default' | 'danger';
  showChevron?: boolean;
};

// One row in a grouped list — icon chip + label/description + optional
// trailing content + chevron. Mirrors hub-page's SettingsRow field-for-
// field (icon chip, danger variant, optional chevron), the shared
// primitive its own design audit called for; used here for Settings' and
// Profile's row-based sections instead of each screen hand-rolling its own.
export function ListRow({ icon, label, description, trailing, onPress, variant = 'default', showChevron = true }: ListRowProps) {
  const content = (
    <View style={styles.row}>
      <IconChip name={icon} tone={variant === 'danger' ? 'danger' : 'tint'} />
      <View style={styles.body}>
        <Text style={[styles.label, variant === 'danger' && styles.labelDanger]} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text style={styles.description} numberOfLines={1}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing}
      {showChevron && onPress ? <Icon name="chevron-right" size={16} color={colors.muted} /> : null}
    </View>
  );

  if (!onPress) return content;
  return <Button onPress={onPress}>{content}</Button>;
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  divider: {
    backgroundColor: colors.line,
    height: 1,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: colors.ink,
    fontFamily: fontFamily.sansMedium,
    fontSize: typography.small,
    fontWeight: '600',
  },
  labelDanger: {
    color: colors.danger,
  },
  description: {
    color: colors.muted,
    fontFamily: fontFamily.sans,
    fontSize: typography.caption,
  },
});
