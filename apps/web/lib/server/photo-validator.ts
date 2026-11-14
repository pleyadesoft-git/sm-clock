import 'server-only';
import sharp from 'sharp';

export const MAX_PHOTO_UPLOAD_BYTES = 1_048_576; // 1 MB
export const MAX_PHOTO_DIMENSION_PX = 720;
export const THUMB_DIMENSION_PX = 128;

export type DetectedImageMime = 'image/webp' | 'image/jpeg' | 'image/png';

/**
 * Valida la firma binaria real (magic bytes) del archivo sin confiar en la extensión
 * ni en el encabezado Content-Type enviado por el cliente.
 */
export function detectImageMagicBytes(
  buffer: Uint8Array,
): DetectedImageMime | null {
  if (buffer.byteLength < 12) {
    return null;
  }

  // WebP: "RIFF" (0..3) + "WEBP" (8..11)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  return null;
}

export interface ValidatedEmployeePhoto {
  mainBuffer: Buffer;
  thumbBuffer: Buffer;
  width: number;
  height: number;
  mimeType: 'image/webp';
}

export async function validateAndProcessEmployeePhoto(
  inputBytes: Uint8Array,
): Promise<
  | { ok: true; data: ValidatedEmployeePhoto }
  | { ok: false; status: 400 | 413 | 415 | 422; message: string }
> {
  if (inputBytes.byteLength === 0) {
    return { ok: false, status: 400, message: 'El archivo de imagen está vacío' };
  }

  if (inputBytes.byteLength > MAX_PHOTO_UPLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      message: 'La imagen excede el tamaño máximo permitido de 1 MB',
    };
  }

  const detectedMime = detectImageMagicBytes(inputBytes);
  if (!detectedMime) {
    return {
      ok: false,
      status: 415,
      message:
        'Formato de archivo no permitido. Solo se aceptan imágenes WebP, JPEG o PNG válidas.',
    };
  }

  const nodeBuffer = Buffer.from(inputBytes);
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(nodeBuffer).metadata();
  } catch {
    return {
      ok: false,
      status: 422,
      message: 'No se pudo decodificar la imagen proporcionada',
    };
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width <= 0 || height <= 0) {
    return {
      ok: false,
      status: 422,
      message: 'Dimensiones de imagen inválidas',
    };
  }

  if (Math.max(width, height) > MAX_PHOTO_DIMENSION_PX) {
    return {
      ok: false,
      status: 422,
      message: `La imagen (${width}×${height} px) supera el máximo permitido de ${MAX_PHOTO_DIMENSION_PX} px por lado`,
    };
  }

  // Re-codificar aplicando rotación EXIF y eliminando metadatos EXIF/GPS por privacidad
  const mainBuffer = await sharp(nodeBuffer)
    .rotate()
    .resize({
      width: MAX_PHOTO_DIMENSION_PX,
      height: MAX_PHOTO_DIMENSION_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer();

  const thumbBuffer = await sharp(nodeBuffer)
    .rotate()
    .resize({
      width: THUMB_DIMENSION_PX,
      height: THUMB_DIMENSION_PX,
      fit: 'cover',
    })
    .webp({ quality: 80 })
    .toBuffer();

  const finalMeta = await sharp(mainBuffer).metadata();

  return {
    ok: true,
    data: {
      mainBuffer,
      thumbBuffer,
      width: finalMeta.width ?? width,
      height: finalMeta.height ?? height,
      mimeType: 'image/webp',
    },
  };
}
