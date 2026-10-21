import { launchImageLibraryAsync } from 'expo-image-picker';

import type { CaptureMeta, ImageInput } from '@/api';

import { parseFocal } from './capture-meta';
import { prepareImage } from './image';

/**
 * Pick existing wall photos from the library instead of shooting new ones.
 * Same output as a camera capture, except there's no gravity vector (the phone's
 * tilt when the photo was taken is unknown) — CaptureMeta allows that.
 */
export async function pickWallPhotos(
  limit: number,
): Promise<{ image: ImageInput; meta: CaptureMeta }[]> {
  const result = await launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    exif: true, // focal length, read before prepareImage strips EXIF
    quality: 1,
  });
  if (result.canceled) return [];
  return Promise.all(
    result.assets.slice(0, limit).map(async (a) => {
      const image = await prepareImage(a.uri, a.width, a.height);
      return {
        image,
        meta: {
          originalWidth: a.width,
          originalHeight: a.height,
          uploadWidth: image.width,
          uploadHeight: image.height,
          ...parseFocal(a.exif),
        },
      };
    }),
  );
}
