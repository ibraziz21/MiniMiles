import { useRef, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

import { Icon, PrimaryButton, ScrollView, StyleSheet, Text, TextButton, colors, fontFamily } from '@/design-system';
import type { PlaceShareContent } from './place-share-sheet';

export function PlaceStoryCard({ content, onBack, onCopyLink }: {
  content: PlaceShareContent;
  onBack: () => void;
  onCopyLink: () => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 40, 300);
  const artwork = useRef<View>(null);
  const exportPending = useRef(false);
  const [photoEnabled, setPhotoEnabled] = useState(!content.visit);
  const [selectedPhoto, setSelectedPhoto] = useState(content.verifiedPhotos?.[0]?.displayUrl);
  const [imageIndex, setImageIndex] = useState(0);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verifiedPhotos = content.verifiedPhotos ?? [];
  const bannerUrl = content.imageKind === 'photo' ? content.imageUrl : null;
  const photoUrls = [...new Set([selectedPhoto, bannerUrl].filter((url): url is string => Boolean(url)))];
  const logoUrl = content.logoUrl ?? (content.imageKind === 'logo' ? content.imageUrl : null);
  const candidates = [...(photoEnabled ? photoUrls : []), ...(logoUrl ? [logoUrl] : [])];
  const imageUrl = candidates[imageIndex];
  const selectedPhotoFailed = photoEnabled && Boolean(selectedPhoto) && imageIndex > 0;
  const isLogo = imageUrl === logoUrl;
  const favorites = content.favoriteProducts?.join(' · ');
  const highlight = content.highlights?.[0];
  const cta = content.visit ? 'View my visit' : 'Explore this place';

  async function shareImage() {
    if (!artwork.current || exportPending.current) return;
    exportPending.current = true;
    setExporting(true);
    setError(null);
    try {
      if (!await Sharing.isAvailableAsync()) {
        setError('Image sharing isn’t available on this device.');
        return;
      }
      const uri = await captureRef(artwork, { format: 'png', width: 1080, height: 1920 });
      await onCopyLink();
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share Akiba Story card' });
    } catch {
      setError('Couldn’t share the Story card. Try again.');
    } finally {
      exportPending.current = false;
      setExporting(false);
    }
  }

  return (
    <>
      {verifiedPhotos.length > 0 ? (
        <View style={styles.photoPicker}>
          <Text style={styles.pickerHeading}>Choose a verified photo</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoOptions}>
            {verifiedPhotos.map((photo, index) => {
              const selected = photoEnabled && selectedPhoto === photo.displayUrl && !selectedPhotoFailed;
              return (
                <Pressable
                  key={photo.displayUrl}
                  accessibilityRole="button"
                  accessibilityLabel={`Use verified photo ${index + 1}`}
                  accessibilityState={{ selected, disabled: exporting }}
                  disabled={exporting}
                  onPress={() => {
                    setSelectedPhoto(photo.displayUrl);
                    setImageIndex(0);
                    setPhotoEnabled(true);
                  }}
                  style={[styles.photoOption, selected && styles.photoOptionSelected]}>
                  <Image source={{ uri: photo.thumbnailUrl }} contentFit="cover" style={styles.thumbnail} />
                  {selected ? (
                    <View style={styles.selectionCheck}>
                      <Icon name="check" size={12} color={colors.white} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          {selectedPhotoFailed ? <Text accessibilityRole="alert" style={styles.help}>This photo couldn’t load. Choose another photo or hide it to share.</Text> : null}
        </View>
      ) : null}
      <View ref={artwork} collapsable={false} style={[styles.artwork, { width: cardWidth }]}>
        <View style={styles.brandRow}>
          <Image accessibilityLabel="Akiba" source={require('../../assets/brand/logo.svg')} style={styles.brand} />
          <Text allowFontScaling={false} style={styles.edition}>EXPLORE</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.media}>
            {imageUrl ? (
              <Image
                key={imageUrl}
                source={{ uri: imageUrl }}
                contentFit={isLogo ? 'contain' : 'cover'}
                style={isLogo ? styles.logo : StyleSheet.absoluteFill}
                onLoad={() => setLoadedUrl(imageUrl)}
                onError={() => setImageIndex((current) => current + 1)}
              />
            ) : <Icon name="shopping-bag" color={colors.tealDark} size={34} />}
            <View style={styles.badge}>
              <Icon name={content.visit ? 'check-circle' : 'map-pin'} size={12} color={colors.tealDark} />
              <Text allowFontScaling={false} style={styles.label}>{content.visit ? 'Verified visit' : 'Place on Akiba'}</Text>
            </View>
          </View>
          <View style={styles.body}>
            {content.category ? <Text allowFontScaling={false} numberOfLines={1} style={styles.category}>{content.category}</Text> : null}
            <Text allowFontScaling={false} numberOfLines={2} style={styles.headline}>{content.name}</Text>
            {favorites ? (
              <View style={styles.detail}>
                <Icon name="heart" size={13} color={colors.tealDark} />
                <View style={styles.detailText}>
                  <Text allowFontScaling={false} style={styles.label}>{content.visit ? 'My favorite' : 'Visit favorites'}</Text>
                  <Text allowFontScaling={false} numberOfLines={2} style={styles.value}>{favorites}</Text>
                </View>
              </View>
            ) : null}
            {highlight ? (
              <View style={styles.detail}>
                <Icon name="star" size={13} color={colors.tealDark} />
                <View style={styles.detailText}>
                  <Text allowFontScaling={false} style={styles.label}>{content.visit ? 'What I liked' : 'What visitors liked'}</Text>
                  <Text allowFontScaling={false} numberOfLines={1} style={styles.value}>{highlight}</Text>
                </View>
              </View>
            ) : null}
            {!favorites && !highlight && content.description ? <Text allowFontScaling={false} numberOfLines={2} style={styles.value}>{content.description}</Text> : null}
            <View style={styles.cta}>
              <Text allowFontScaling={false} style={styles.ctaText}>{cta}</Text>
              <Icon name="arrow-right" size={15} color={colors.white} />
            </View>
          </View>
        </View>
        <View style={styles.stickerSpace} />
      </View>
      {photoUrls.length && (photoEnabled || !verifiedPhotos.length) ? (
        <TextButton label={photoEnabled ? 'Hide photo' : 'Include photo'} onPress={() => {
          if (exportPending.current) return;
          setImageIndex(0);
          setPhotoEnabled(!photoEnabled);
        }} />
      ) : null}
      <Text style={styles.help}>Sharing copies the link for you. Paste it into the caption in WhatsApp Status or a link sticker in Instagram Stories.</Text>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        label={exporting ? 'Preparing image…' : 'Share image & copy link'}
        disabled={exporting || selectedPhotoFailed || Boolean(imageUrl && imageUrl !== loadedUrl)}
        onPress={() => void shareImage()}
      />
      <TextButton label="Copy link" onPress={() => void onCopyLink()} />
      <TextButton label="Back to sharing" onPress={onBack} />
    </>
  );
}

const styles = StyleSheet.create({
  photoPicker: { gap: 6 },
  pickerHeading: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 14 },
  photoOptions: { gap: 8 },
  photoOption: { backgroundColor: colors.tint, borderColor: colors.line, borderRadius: 12, borderWidth: 2, height: 58, overflow: 'hidden', width: 58 },
  photoOptionSelected: { borderColor: colors.tealDark },
  thumbnail: { height: '100%', width: '100%' },
  selectionCheck: { alignItems: 'center', backgroundColor: colors.tealDark, borderRadius: 9, bottom: 3, height: 18, justifyContent: 'center', position: 'absolute', right: 3, width: 18 },
  artwork: { alignSelf: 'center', aspectRatio: 9 / 16, backgroundColor: colors.tint, borderRadius: 16, gap: 12, overflow: 'hidden', padding: 16 },
  brandRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  brand: { height: 28, width: 28 },
  edition: { color: colors.tealDark, fontFamily: fontFamily.sansBold, fontSize: 10, letterSpacing: 2 },
  card: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 18, borderWidth: 1, flex: 1, overflow: 'hidden' },
  media: { alignItems: 'center', backgroundColor: '#D8EEF0', flex: 1, justifyContent: 'center', overflow: 'hidden' },
  logo: { backgroundColor: colors.white, borderRadius: 12, height: '55%', width: '38%' },
  badge: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 8, flexDirection: 'row', gap: 5, left: 10, paddingHorizontal: 8, paddingVertical: 5, position: 'absolute', top: 10 },
  body: { gap: 5, padding: 13 },
  category: { color: colors.tealDark, fontFamily: fontFamily.sansBold, fontSize: 10 },
  headline: { color: colors.ink, fontFamily: fontFamily.sterlingSemiBold, fontSize: 21, lineHeight: 24 },
  detail: { alignItems: 'flex-start', borderColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 7, paddingTop: 5 },
  detailText: { flex: 1 },
  label: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 10, lineHeight: 14 },
  value: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 15 },
  cta: { alignItems: 'center', backgroundColor: '#155965', borderRadius: 9, flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingHorizontal: 10, paddingVertical: 7 },
  ctaText: { color: colors.white, fontFamily: fontFamily.sansBold, fontSize: 12 },
  stickerSpace: { height: 30 },
  help: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontFamily: fontFamily.sans, fontSize: 14 },
});
