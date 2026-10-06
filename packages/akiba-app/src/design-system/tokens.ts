export const colors = {
  teal: '#238D9D',
  tealDark: '#1E7E8D',
  ink: '#0D0E0C',
  muted: '#504C4C',
  paper: '#FCFCFC',
  card: '#F7F7F7',
  line: '#E2E2E2',
  tint: '#EAF7F9',
  white: '#FFFFFF',
  // Satisfied-qualification green — matches hub-page's LoyaltyVoucherCard
  // progress bar (bg-emerald-500), distinct from in-progress teal.
  success: '#10B981',
  // Destructive-action red — matches hub-page's SettingsRow danger variant
  // (text-red-600 / bg-red-50).
  danger: '#DC2626',
  dangerTint: '#FEF2F2',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

// Mirrors hub-page's Tailwind rounded-xl/2xl/3xl/full, as actually used
// across its cards/chips/pills (SettingsRow's icon chip, voucher cards,
// pill buttons/badges).
export const radius = {
  sm: 12,
  md: 16,
  lg: 24,
  full: 999,
} as const;

// Converted from hub-page's tailwind.config.ts boxShadow.soft/chip
// (0 24px 80px rgba(13,14,12,.08) / 0 4px 24px rgba(13,14,12,.06)) into RN's
// shadow* (iOS) + elevation (Android) properties. Requires an opaque
// background on the shadowed view — every Card already has one.
export const shadows = {
  soft: {
    shadowColor: '#0D0E0C',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  chip: {
    shadowColor: '#0D0E0C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;

// These are the actual Akiba typefaces used by hub-page. Sterling's OTF
// files are copied verbatim from react-app; DM Sans is loaded through the
// matching Expo font package in the root layout.
export const fontFamily = {
  sterling: 'FTSterlingRegular',
  sterlingMedium: 'FTSterlingMedium',
  sterlingSemiBold: 'FTSterlingSemiBold',
  sterlingBold: 'FTSterlingBold',
  // Compatibility alias for existing screens while they are ported.
  serif: 'FTSterlingRegular',
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemiBold: 'DMSans_600SemiBold',
  sansBold: 'DMSans_700Bold',
} as const;

// Mirrors the actual text sizes used across hub-page's cards/headings —
// text-[10px] badges through text-3xl page titles — not an arbitrary scale.
export const typography = {
  micro: 10,
  caption: 12,
  small: 14,
  body: 16,
  subtitle: 18,
  section: 20,
  title: 24,
  display: 30,
} as const;
