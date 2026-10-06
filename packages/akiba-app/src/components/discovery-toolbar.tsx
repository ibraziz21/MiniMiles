import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon, colors, fontFamily, shadows } from '@/design-system';

import { ProfileButton } from './profile-button';

type DiscoveryToolbarProps = {
  activeFilterCount?: number;
  onChangeText: (value: string) => void;
  onOpenFilters: () => void;
  onSubmit?: () => void;
  placeholder?: string;
  value: string;
};

export function DiscoveryToolbar({
  activeFilterCount = 0,
  onChangeText,
  onOpenFilters,
  onSubmit,
  placeholder = 'Search merchants…',
  value,
}: DiscoveryToolbarProps) {
  return (
    <View style={styles.toolbar}>
      <View style={styles.searchField}>
        <Icon name="search" size={18} color={colors.muted} />
        <TextInput
          accessibilityLabel="Search merchants, categories and cities"
          enterKeyHint="search"
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={styles.searchInput}
          value={value}
        />
        {value ? (
          <Pressable accessibilityLabel="Clear search" hitSlop={4} onPress={() => onChangeText('')} style={styles.clearButton}>
            <Icon name="x" size={16} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <Pressable
        accessibilityLabel={activeFilterCount ? `Filters, ${activeFilterCount} active` : 'Open filters'}
        accessibilityRole="button"
        hitSlop={4}
        onPress={onOpenFilters}
        style={({ pressed }) => [styles.iconButton, activeFilterCount > 0 && styles.iconButtonActive, pressed && styles.pressed]}>
        <Icon name="sliders" size={19} color={activeFilterCount ? colors.white : colors.ink} />
        {activeFilterCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{activeFilterCount}</Text>
          </View>
        ) : null}
      </Pressable>

      <ProfileButton />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  searchField: {
    ...shadows.chip,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    height: 48,
    minWidth: 0,
    paddingLeft: 13,
  },
  searchInput: {
    color: colors.ink,
    flex: 1,
    fontFamily: fontFamily.sans,
    fontSize: 15,
    minWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 0,
  },
  clearButton: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    width: 40,
  },
  iconButton: {
    ...shadows.chip,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderCurve: 'continuous',
    borderRadius: 16,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    position: 'relative',
    width: 48,
  },
  iconButtonActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderColor: colors.white,
    borderRadius: 999,
    borderWidth: 2,
    height: 19,
    justifyContent: 'center',
    position: 'absolute',
    right: -3,
    top: -4,
    minWidth: 19,
    paddingHorizontal: 3,
  },
  badgeText: {
    color: colors.white,
    fontFamily: fontFamily.sansBold,
    fontSize: 9,
    lineHeight: 11,
  },
  pressed: {
    opacity: 0.76,
    transform: [{ scale: 0.97 }],
  },
});
