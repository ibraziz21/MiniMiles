import { StyleSheet, View } from 'react-native';
import type { ComponentProps } from 'react';
import type { Feather } from '@expo/vector-icons';

import { Icon } from './icon';
import { colors, radius } from './tokens';

type FeatherName = ComponentProps<typeof Feather>['name'];

type IconChipProps = {
  name: FeatherName;
  /** 'danger' mirrors hub-page's SettingsRow danger variant (bg-red-50). */
  tone?: 'tint' | 'danger';
};

// 36×36 colored-background square with a centered icon — mirrors
// hub-page's SettingsRow icon chip (`h-9 w-9 rounded-xl bg-akiba-tint`).
export function IconChip({ name, tone = 'tint' }: IconChipProps) {
  return (
    <View style={[styles.chip, tone === 'danger' && styles.chipDanger]}>
      <Icon name={name} size={16} color={tone === 'danger' ? colors.danger : colors.teal} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: colors.tint,
    borderRadius: radius.sm,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  chipDanger: {
    backgroundColor: colors.dangerTint,
  },
});
