import { Card, ScrollView, StyleSheet, Text, View, colors, spacing, typography } from '@/design-system';
import { ProfileButton } from '@/components/profile-button';

type ComingSoonScreenProps = {
  title: string;
  description?: string;
};

export function ComingSoonScreen({ title, description = 'Coming soon' }: ComingSoonScreenProps) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.scrollContent}
      style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.screenHeader}>
          <Text style={styles.screenTitle}>{title}</Text>
          <ProfileButton />
        </View>
        <Card style={styles.card}>
          <Text style={styles.body}>{description}</Text>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
  },
  scrollContent: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  content: {
    alignSelf: 'center',
    gap: spacing.md,
    maxWidth: 520,
    width: '100%',
  },
  screenHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  screenTitle: {
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '700',
  },
  card: {
    gap: spacing.sm,
  },
  body: {
    color: colors.muted,
    fontSize: typography.body,
  },
});
