import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator, Icon, fontFamily } from '@/design-system';

export const palette = { teal: '#006673', ink: '#1A1C1C', muted: '#3E494B', paper: '#F9F9F9', card: '#F3F3F3', tint: '#EAF7F9', line: '#E8E8E8', danger: '#BA1A1A' };
export function Action({ label, onPress, primary, disabled, icon }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; icon?: React.ComponentProps<typeof Icon>['name'] }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [ui.action, primary && ui.primary, (pressed || disabled) && { opacity: 0.55 }]}>{icon ? <Icon name={icon} color={primary ? '#fff' : palette.teal} size={16} /> : null}<Text style={[ui.actionText, primary && { color: '#fff' }]}>{label}</Text></Pressable>;
}
export function Pills<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return <View accessibilityRole="tablist" style={ui.pills}>{options.map(option => <Pressable accessibilityRole="tab" accessibilityState={{ selected: value === option.value }} key={option.value} onPress={() => onChange(option.value)} style={[ui.pill, value === option.value && ui.primary]}><Text style={[ui.pillText, value === option.value && { color: '#fff' }]}>{option.label}</Text></Pressable>)}</View>;
}
export function Notice({ title, body, action, onAction, error }: { title: string; body?: string; action?: string; onAction?: () => void; error?: boolean }) {
  return <View accessibilityLiveRegion="polite" style={[ui.notice, error && { backgroundColor: '#FFF0EE' }]}><Icon name={error ? 'alert-circle' : 'inbox'} size={24} color={error ? palette.danger : palette.teal} /><Text style={ui.title}>{title}</Text>{body ? <Text style={[ui.body, { textAlign: 'center' }]}>{body}</Text> : null}{action && onAction ? <Action label={action} onPress={onAction} /> : null}</View>;
}
export function Loading() { return <View accessibilityLabel="Loading" style={ui.loading}><ActivityIndicator color={palette.teal} /></View>; }
export function Card({ children }: { children: ReactNode }) { return <View style={ui.card}>{children}</View>; }
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.paper }, page: { width: '100%', maxWidth: 620, alignSelf: 'center', padding: 16, paddingBottom: 32 },
  body: { color: palette.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 21 }, title: { color: palette.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 16, lineHeight: 23 }, heading: { color: palette.ink, fontFamily: fontFamily.sansBold, fontSize: 21 }, meta: { color: palette.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: palette.card, borderRadius: 16, padding: 16, gap: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, flex: { flex: 1 }, stack: { gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  action: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }, actionText: { color: palette.teal, fontFamily: fontFamily.sansSemiBold, fontSize: 14 }, primary: { backgroundColor: palette.teal },
  pills: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' }, pill: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: palette.card, borderRadius: 24, justifyContent: 'center' }, pillText: { color: palette.muted, fontSize: 13, fontFamily: fontFamily.sansMedium },
  notice: { alignItems: 'center', padding: 24, gap: 8, borderRadius: 16, backgroundColor: palette.card }, loading: { padding: 40, alignItems: 'center' }, badge: { color: palette.teal, fontSize: 12, fontFamily: fontFamily.sansMedium, backgroundColor: palette.tint, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start', overflow: 'hidden' },
});
