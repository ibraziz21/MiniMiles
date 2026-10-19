import type { ImagePickerAsset } from 'expo-image-picker';

export const MAX_VERIFIED_VISIT_PHOTOS = 3;
export const MAX_VERIFIED_VISIT_PHOTO_BYTES = 10 * 1024 * 1024;

const ACCEPTED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

export function resolveVerifiedVisitPhotoContentType(
  asset: Pick<ImagePickerAsset, 'fileName' | 'mimeType' | 'uri'>,
): string | null {
  const declared = asset.mimeType?.toLowerCase();
  if (declared && ACCEPTED_CONTENT_TYPES.has(declared)) return declared;

  const name = `${asset.fileName ?? ''} ${asset.uri}`.toLowerCase().split('?')[0];
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic')) return 'image/heic';
  return null;
}

export function verifiedVisitPhotoValidationError(
  asset: Pick<ImagePickerAsset, 'fileName' | 'fileSize' | 'mimeType' | 'uri'>,
): string | null {
  if (!resolveVerifiedVisitPhotoContentType(asset)) {
    return 'Choose a JPEG, PNG, WebP or HEIC photo.';
  }
  if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_VERIFIED_VISIT_PHOTO_BYTES) {
    return 'Photos must be 10 MB or smaller.';
  }
  return null;
}
