import { useState } from 'react';
import { Linking, Modal, Platform, Pressable, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceStoryCard } from './place-story-card';

import { Icon, PrimaryButton, TextButton, ScrollView, StyleSheet, Text, View, colors, fontFamily } from '@/design-system';

export function publicPlaceLink(slug: string, visitId?: string) {
  const profile = `https://pass.akibamiles.com/merchants/${encodeURIComponent(slug)}`;
  return visitId ? `${profile}?visit=${encodeURIComponent(visitId)}` : profile;
}

export type PlaceShareContent = {
  title: string;
  name: string;
  imageUrl?: string | null;
  imageKind?: 'photo' | 'logo';
  verifiedPhotos?: { displayUrl: string; thumbnailUrl: string }[];
  logoUrl?: string | null;
  favoriteProducts?: string[];
  highlights?: string[];
  category?: string | null;
  description?: string | null;
  url: string;
  visit?: boolean;
};

export function PlaceShareSheet({ content, onClose }: { content: PlaceShareContent; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);

  async function copyLink() {
    try {
      const copied = await Clipboard.setStringAsync(content.url);
      setFeedback(copied ? 'Link copied.' : 'Couldn’t copy the link.');
    } catch {
      setFeedback('Couldn’t copy the link.');
    }
  }
  const [sharing, setSharing] = useState(false);

  async function shareLink() {
    setSharing(true);
    setFeedback(null);
    try {
      const message = content.description ? `${content.name}\n${content.description}` : content.name;
      await Share.share(Platform.OS === 'ios'
        ? { message, url: content.url }
        : { title: content.title, message: `${message}\n${content.url}` });
    } catch {
      setFeedback('Couldn’t open sharing. Try again.');
    } finally {
      setSharing(false);
    }
  }

  async function shareOn(network: 'x' | 'facebook') {
    setFeedback(null);
    const link = encodeURIComponent(content.url);
    const caption = encodeURIComponent(content.visit
      ? `My verified visit to ${content.name} on Akiba`
      : `Check out ${content.name} on Akiba`);
    try {
      await Linking.openURL(network === 'x'
        ? `https://twitter.com/intent/tweet?text=${caption}&url=${link}`
        : `https://www.facebook.com/sharer/sharer.php?u=${link}`);
    } catch {
      setFeedback('Couldn’t open sharing. You can copy the link and paste it into your post.');
    }
  }

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close share preview" onPress={onClose} style={styles.scrim} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.heading}>{storyOpen ? 'Story card' : content.title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close share preview" onPress={onClose} style={styles.close}>
              <Icon name="x" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            {storyOpen ? (
              <PlaceStoryCard content={content} onBack={() => { setStoryOpen(false); setFeedback(null); }} onCopyLink={copyLink} />
            ) : (
              <>
                <View style={styles.preview}>
                  {!content.visit && content.imageUrl ? <Image source={{ uri: content.imageUrl }} contentFit={content.imageKind === 'logo' ? 'contain' : 'cover'} style={styles.image} /> : null}
                  <Text style={styles.label}>{content.visit ? 'Verified visit' : 'Place on Akiba'}</Text>
                  <Text style={styles.name}>{content.name}</Text>
                  {content.description ? <Text style={styles.body}>{content.description}</Text> : null}
                </View>
                <Text selectable style={styles.body}>{content.url}</Text>
                <PrimaryButton label="Share link" onPress={() => void shareLink()} disabled={sharing} />
                <View style={styles.socialActions}>
                  <TextButton label="Post on X" onPress={() => void shareOn('x')} />
                  <TextButton label="Share on Facebook" onPress={() => void shareOn('facebook')} />
                </View>
                <TextButton label="Copy link" onPress={() => void copyLink()} />
                <TextButton label="Story card" onPress={() => { setStoryOpen(true); setFeedback(null); }} />
              </>
            )}
            {feedback ? <Text accessibilityLiveRegion="polite" style={styles.body}>{feedback}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', overflow: 'hidden' },
  header: { alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 8 },
  heading: { color: colors.ink, flex: 1, fontFamily: fontFamily.sterlingSemiBold, fontSize: 22 },
  close: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  content: { gap: 12, padding: 20 },
  socialActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-evenly' },
  preview: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 16, borderWidth: 1, gap: 6, overflow: 'hidden', padding: 12 },
  image: { backgroundColor: colors.tint, borderRadius: 10, height: 124, width: '100%' },
  label: { color: colors.tealDark, fontFamily: fontFamily.sansSemiBold, fontSize: 12 },
  name: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 20 },
  body: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14 },
});
