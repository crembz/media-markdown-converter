// Shared image-downscaling helpers. Previously duplicated verbatim between
// src/utils/pdf.ts and src/components/ImageUploader.tsx.

// Longest edge, in pixels, of an image sent to a vision model. Big enough to
// keep small print legible, small enough to keep the base64 payload sane.
export const MAX_IMAGE_DIMENSION = 2048;

export const JPEG_QUALITY = 0.75;

/**
 * Scale factor that fits `width` x `height` inside MAX_IMAGE_DIMENSION on both
 * axes, never enlarging beyond `max`.
 */
export function fitScale(width: number, height: number, max = 1): number {
  return Math.min(max, MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
}

/**
 * Downscales a data URI whose pixel dimensions exceed MAX_IMAGE_DIMENSION,
 * re-encoding as JPEG. Returns the input untouched when it already fits.
 *
 * Only for images that arrive already encoded (an uploaded file). Anything
 * rendered onto a canvas should size the canvas up front with fitScale and
 * encode once, rather than encoding and then re-encoding through here.
 */
export function resizeIfNeeded(dataUri: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= MAX_IMAGE_DIMENSION && img.height <= MAX_IMAGE_DIMENSION) {
        resolve(dataUri);
        return;
      }

      const canvas = document.createElement('canvas');
      const scale = fitScale(img.width, img.height);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context while resizing image'));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const resized = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      canvas.width = 0;
      canvas.height = 0;
      resolve(resized);
    };
    img.onerror = () => reject(new Error('Failed to load image for resizing'));
    img.src = dataUri;
  });
}
