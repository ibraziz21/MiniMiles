import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { colors } from './tokens';

type FeatherName = ComponentProps<typeof Feather>['name'];
type MaterialName = ComponentProps<typeof MaterialCommunityIcons>['name'];

// Thin wrapper over Feather (bundled with every Expo install, no new
// native dependency) — the closest stock icon set to hub-page's
// lucide-react, since Lucide is a continuation of Feather's stroke style.
// One import point keeps sizing/color defaults consistent app-wide.
export function Icon({
  name,
  size = 16,
  color = colors.ink,
}: {
  name: FeatherName;
  size?: number;
  color?: string;
}) {
  return <Feather name={name} size={size} color={color} />;
}

export function MaterialIcon({
  name,
  size = 16,
  color = colors.ink,
}: {
  name: MaterialName;
  size?: number;
  color?: string;
}) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}
