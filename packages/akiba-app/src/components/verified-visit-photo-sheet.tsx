import { useState } from 'react';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createApiClient } from '@/api';
import { readApiErrorEnvelope } from '@/api/errors';
import { supabase } from '@/auth';
import type { MemberVerifiedVisit } from '@/contracts';
import { ActivityIndicator, Icon, colors, fontFamily, shadows } from '@/design-system';
import {
  MAX_VERIFIED_VISIT_PHOTO_BYTES,
  MAX_VERIFIED_VISIT_PHOTOS,
  resolveVerifiedVisitPhotoContentType,
  verifiedVisitPhotoValidationError,
} from '@/lib/verified-visit-photos';

type UploadState = 'uploading' | 'done' | 'error';

type LocalPhoto = {
  localId: string;
  asset: ImagePicker.ImagePickerAsset;
  contentType: string;
  status: UploadState;
  photoId?: string;
  error?: string;
};

function localId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function photoStatusCopy(photoState: MemberVerifiedVisit['photoState']) {
  if (photoState === 'under_review') return 'Your earlier photo is still being reviewed.';
  if (photoState === 'approved') return 'Your approved photo is already helping the community.';
  if (photoState === 'not_approved') return 'Your visit is saved. You can choose a different photo.';
  return 'Your visit is saved without a photo. Add one now if you would like.';
}

function uploadErrorMessage(error: unknown) {
  const envelope = readApiErrorEnvelope(error);
  if (envelope?.code === 'PHOTO_LIMIT_REACHED') return 'This visit already has the maximum of three photos.';
  if (envelope?.message) return envelope.message;
  if (error instanceof Error && error.message) return error.message;
  return 'The photo could not be uploaded. Try again.';
}

export function VerifiedVisitPhotoSheet({
  accessToken,
  merchantName,
  onClose,
  onUpdated,
  visit,
  visible,
}: {
  accessToken: string;
  merchantName: string;
  onClose: () => void;
  onUpdated: () => Promise<void>;
  visit: MemberVerifiedVisit;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const activeUpload = photos.some((photo) => photo.status === 'uploading');
  const occupiedSlots = photos.length;
  const completedCount = photos.filter((photo) => photo.status === 'done').length;

  function updatePhoto(id: string, update: Partial<LocalPhoto>) {
    setPhotos((current) => current.map((photo) => photo.localId === id ? { ...photo, ...update } : photo));
  }

  async function uploadPhoto(photo: LocalPhoto) {
    setSheetError(null);
    updatePhoto(photo.localId, { status: 'uploading', error: undefined, photoId: undefined });
    const client = createApiClient({ accessToken });
    let photoId: string | undefined;

    try {
      const source = await fetch(photo.asset.uri);
      const bytes = await source.arrayBuffer();
      if (bytes.byteLength > MAX_VERIFIED_VISIT_PHOTO_BYTES) {
        throw new Error('Photos must be 10 MB or smaller.');
      }

      const intent = await client.createVerifiedVisitPhotoUploadIntent(visit.id, photo.contentType);
      photoId = intent.photoId;
      updatePhoto(photo.localId, { photoId });

      const { error: storageError } = await supabase.storage
        .from(intent.bucket)
        .upload(intent.path, bytes, { contentType: photo.contentType, upsert: false });
      if (storageError) throw storageError;

      await client.completeVerifiedVisitPhotoUpload(visit.id, intent.photoId);
      updatePhoto(photo.localId, { status: 'done' });
      void onUpdated().catch(() => null);
    } catch (error) {
      if (photoId) {
        await client.withdrawVerifiedVisitPhoto(visit.id, photoId).catch(() => null);
      }
      updatePhoto(photo.localId, { status: 'error', error: uploadErrorMessage(error), photoId: undefined });
    }
  }

  async function addAsset(asset: ImagePicker.ImagePickerAsset) {
    const validationError = verifiedVisitPhotoValidationError(asset);
    if (validationError) {
      setSheetError(validationError);
      return;
    }
    const contentType = resolveVerifiedVisitPhotoContentType(asset);
    if (!contentType) return;

    const photo: LocalPhoto = { localId: localId(), asset, contentType, status: 'uploading' };
    setPhotos((current) => [...current, photo]);
    await uploadPhoto(photo);
  }

  async function chooseFromLibrary() {
    if (occupiedSlots >= MAX_VERIFIED_VISIT_PHOTOS) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow photo access in Settings to choose a verified visit photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
      selectionLimit: 1,
    });
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0]);
  }

  async function takePhoto() {
    if (occupiedSlots >= MAX_VERIFIED_VISIT_PHOTOS) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings to take a verified visit photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) await addAsset(result.assets[0]);
  }

  async function removePhoto(photo: LocalPhoto) {
    if (photo.status === 'uploading') return;
    if (photo.photoId) {
      try {
        await createApiClient({ accessToken }).withdrawVerifiedVisitPhoto(visit.id, photo.photoId);
      } catch (error) {
        setSheetError(uploadErrorMessage(error));
        return;
      }
    }
    setPhotos((current) => current.filter((candidate) => candidate.localId !== photo.localId));
    void onUpdated().catch(() => null);
  }

  function closeSheet() {
    if (activeUpload) return;
    setPhotos([]);
    setSheetError(null);
    onClose();
  }

  return (
    <Modal animationType="slide" onRequestClose={closeSheet} transparent visible={visible}>
      <View style={styles.scrim}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.flex}>
              <Text style={styles.eyebrow}>YOUR VERIFIED VISIT</Text>
              <Text style={styles.title}>Add photos</Text>
            </View>
            <Pressable
              accessibilityLabel="Close photo uploader"
              disabled={activeUpload}
              onPress={closeSheet}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed, activeUpload && styles.disabled]}
            >
              <Icon name="x" size={21} color={colors.ink} />
            </Pressable>
          </View>

          <Text style={styles.merchant}>{merchantName}</Text>
          <Text style={styles.body}>{photoStatusCopy(visit.photoState)}</Text>
          <View style={styles.guidance}>
            <Icon name="shield" size={17} color={colors.teal} />
            <Text style={styles.guidanceText}>Avoid faces, children, receipts and personal information. Photos appear publicly only after Akiba review.</Text>
          </View>

          {sheetError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{sheetError}</Text> : null}

          <View style={styles.photoRow}>
            {photos.map((photo) => (
              <View key={photo.localId} style={styles.previewWrap}>
                <Image source={{ uri: photo.asset.uri }} style={styles.preview} contentFit="cover" />
                <View style={styles.previewShade} />
                {photo.status === 'uploading' ? <ActivityIndicator color={colors.white} /> : null}
                {photo.status === 'done' ? <View style={styles.doneBadge}><Icon name="check" size={16} color={colors.white} /></View> : null}
                {photo.status === 'error' ? (
                  <Pressable accessibilityLabel="Retry photo upload" onPress={() => uploadPhoto(photo)} style={styles.retryButton}>
                    <Icon name="refresh-cw" size={15} color={colors.white} />
                    <Text style={styles.retryText}>Retry</Text>
                  </Pressable>
                ) : null}
                {photo.status !== 'uploading' ? (
                  <Pressable accessibilityLabel="Remove photo" onPress={() => removePhoto(photo)} style={styles.removeButton}>
                    <Icon name="x" size={15} color={colors.ink} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {Array.from({ length: Math.max(0, MAX_VERIFIED_VISIT_PHOTOS - photos.length) }).map((_, index) => (
              <View key={`empty-${index}`} style={styles.emptySlot}><Icon name="image" size={22} color={colors.muted} /></View>
            ))}
          </View>

          <Text style={styles.counter}>{completedCount > 0 ? `${completedCount} submitted for review · ` : ''}Up to three photos total</Text>

          <View style={styles.actions}>
            <Pressable disabled={activeUpload || occupiedSlots >= MAX_VERIFIED_VISIT_PHOTOS} onPress={takePhoto} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed, (activeUpload || occupiedSlots >= MAX_VERIFIED_VISIT_PHOTOS) && styles.disabled]}>
              <Icon name="camera" size={19} color={colors.ink} />
              <Text style={styles.actionText}>Camera</Text>
            </Pressable>
            <Pressable disabled={activeUpload || occupiedSlots >= MAX_VERIFIED_VISIT_PHOTOS} onPress={chooseFromLibrary} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed, (activeUpload || occupiedSlots >= MAX_VERIFIED_VISIT_PHOTOS) && styles.disabled]}>
              <Icon name="image" size={19} color={colors.ink} />
              <Text style={styles.actionText}>Photo library</Text>
            </Pressable>
          </View>

          <Pressable disabled={activeUpload} onPress={closeSheet} style={({ pressed }) => [styles.doneButton, pressed && styles.doneButtonPressed, activeUpload && styles.disabled]}>
            <Text style={styles.doneText}>{activeUpload ? 'Uploading…' : completedCount > 0 ? 'Done' : 'Not now'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: colors.scrim, flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, ...shadows.soft },
  handle: { alignSelf: 'center', backgroundColor: colors.line, borderRadius: 999, height: 4, marginBottom: 14, width: 44 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  eyebrow: { color: colors.teal, fontFamily: fontFamily.sansBold, fontSize: 10, letterSpacing: 1.1 },
  title: { color: colors.ink, fontFamily: fontFamily.sterlingBold, fontSize: 25, marginTop: 2 },
  closeButton: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 999, height: 44, justifyContent: 'center', width: 44 },
  merchant: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 15, marginTop: 18 },
  body: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 13, lineHeight: 19, marginTop: 3 },
  guidance: { alignItems: 'flex-start', backgroundColor: colors.tint, borderRadius: 14, flexDirection: 'row', gap: 9, marginTop: 15, padding: 12 },
  guidanceText: { color: colors.muted, flex: 1, fontFamily: fontFamily.sans, fontSize: 12, lineHeight: 17 },
  error: { backgroundColor: colors.dangerTint, borderRadius: 12, color: colors.danger, fontFamily: fontFamily.sansMedium, fontSize: 12, lineHeight: 17, marginTop: 12, padding: 11 },
  photoRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  previewWrap: { alignItems: 'center', aspectRatio: 1, backgroundColor: colors.ink, borderRadius: 16, flex: 1, justifyContent: 'center', maxWidth: '32%', overflow: 'visible', position: 'relative' },
  preview: { borderRadius: 16, height: '100%', width: '100%' },
  previewShade: { backgroundColor: colors.imageShade, borderRadius: 16, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  emptySlot: { alignItems: 'center', aspectRatio: 1, backgroundColor: colors.card, borderColor: colors.line, borderRadius: 16, borderStyle: 'dashed', borderWidth: 1, flex: 1, justifyContent: 'center', maxWidth: '32%' },
  doneBadge: { alignItems: 'center', backgroundColor: colors.success, borderRadius: 999, height: 30, justifyContent: 'center', position: 'absolute', width: 30 },
  retryButton: { alignItems: 'center', flexDirection: 'row', gap: 5, minHeight: 44, paddingHorizontal: 6, position: 'absolute' },
  retryText: { color: colors.white, fontFamily: fontFamily.sansSemiBold, fontSize: 11 },
  removeButton: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 999, height: 34, justifyContent: 'center', position: 'absolute', right: -7, top: -7, width: 34, ...shadows.chip },
  counter: { color: colors.muted, fontFamily: fontFamily.sans, fontSize: 11, marginTop: 9 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  actionButton: { alignItems: 'center', backgroundColor: colors.white, borderColor: colors.line, borderRadius: 999, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 50, paddingHorizontal: 12 },
  actionText: { color: colors.ink, fontFamily: fontFamily.sansSemiBold, fontSize: 13 },
  doneButton: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: 999, justifyContent: 'center', marginTop: 12, minHeight: 52 },
  doneButtonPressed: { backgroundColor: colors.tealDark },
  doneText: { color: colors.white, fontFamily: fontFamily.sansBold, fontSize: 14 },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.5 },
});
