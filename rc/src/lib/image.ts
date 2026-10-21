import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import type { ImageInput } from '@/api';

const MAX_WIDTH = 1600;

/**
 * Resize + compress a captured photo before "upload" (design doc M2).
 * Keeps aspect ratio; downscales only if wider than MAX_WIDTH.
 */
export async function prepareImage(
  uri: string,
  width: number,
  height: number,
): Promise<ImageInput> {
  const actions = width > MAX_WIDTH ? [{ resize: { width: MAX_WIDTH } }] : [];
  const result = await manipulateAsync(uri, actions, {
    compress: 0.6,
    format: SaveFormat.JPEG,
  });
  return { uri: result.uri, width: result.width, height: result.height };
}
