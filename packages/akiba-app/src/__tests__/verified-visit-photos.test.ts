import { describe, expect, it } from 'vitest';

import {
  MAX_VERIFIED_VISIT_PHOTO_BYTES,
  resolveVerifiedVisitPhotoContentType,
  verifiedVisitPhotoValidationError,
} from '@/lib/verified-visit-photos';

describe('verified visit photo selection', () => {
  it('uses an accepted picker MIME type', () => {
    expect(resolveVerifiedVisitPhotoContentType({
      fileName: 'photo.bin',
      mimeType: 'image/webp',
      uri: 'content://photo',
    })).toBe('image/webp');
  });

  it('infers common image types when a provider omits the MIME type', () => {
    expect(resolveVerifiedVisitPhotoContentType({
      fileName: null,
      mimeType: undefined,
      uri: 'file:///camera/visit.JPEG',
    })).toBe('image/jpeg');
  });

  it('rejects unsupported and oversized files before creating an upload intent', () => {
    expect(verifiedVisitPhotoValidationError({
      fileName: 'visit.gif',
      fileSize: 100,
      mimeType: 'image/gif',
      uri: 'file:///visit.gif',
    })).toContain('JPEG');

    expect(verifiedVisitPhotoValidationError({
      fileName: 'visit.jpg',
      fileSize: MAX_VERIFIED_VISIT_PHOTO_BYTES + 1,
      mimeType: 'image/jpeg',
      uri: 'file:///visit.jpg',
    })).toContain('10 MB');
  });
});
