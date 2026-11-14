export const MAX_EXPORT_SIDE_PX = 720;
export const MAX_INPUT_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_INPUT_SIDE_PX = 8000;

export interface CropTransform {
  rotationQuarterTurns: 0 | 1 | 2 | 3; // 0°, 90°, 180°, 270°
  fineAngleDeg: number; // -45° a +45°
  zoom: number; // 1.0 a 3.0
  offsetX: number; // -1.0 a +1.0 (normalizado)
  offsetY: number; // -1.0 a +1.0 (normalizado)
  aspect: '1:1' | 'free';
}

export interface ExportDimensions {
  sourceOrientedWidth: number;
  sourceOrientedHeight: number;
  cropWidth: number;
  cropHeight: number;
  outputWidth: number;
  outputHeight: number;
}

/**
 * Calcula las dimensiones orientadas, el recorte acotado y las dimensiones finales
 * de exportación garantizando que el lado mayor sea SIEMPRE <= maxSide (720 px por defecto)
 * y que nunca se amplíe una imagen cuyo recorte sea menor a maxSide.
 */
export function computeExportDimensions(
  sourceWidth: number,
  sourceHeight: number,
  transform: CropTransform,
  maxSide: number = MAX_EXPORT_SIDE_PX,
): ExportDimensions {
  const safeMaxSide = Math.min(MAX_EXPORT_SIDE_PX, Math.max(64, Math.floor(maxSide)));
  const safeZoom = Math.min(3, Math.max(1, transform.zoom));
  const isRotated90or270 =
    transform.rotationQuarterTurns === 1 || transform.rotationQuarterTurns === 3;

  const orientedWidth = isRotated90or270 ? sourceHeight : sourceWidth;
  const orientedHeight = isRotated90or270 ? sourceWidth : sourceHeight;

  let cropWidth: number;
  let cropHeight: number;

  if (transform.aspect === '1:1') {
    const minSide = Math.min(orientedWidth, orientedHeight);
    const squareSide = Math.max(1, Math.floor(minSide / safeZoom));
    cropWidth = squareSide;
    cropHeight = squareSide;
  } else {
    cropWidth = Math.max(1, Math.floor(orientedWidth / safeZoom));
    cropHeight = Math.max(1, Math.floor(orientedHeight / safeZoom));
  }

  const largestCropSide = Math.max(cropWidth, cropHeight);
  // Jamás ampliar imágenes pequeñas (scale <= 1) y garantizar lado mayor <= safeMaxSide (720 px)
  const scale = largestCropSide > safeMaxSide ? safeMaxSide / largestCropSide : 1;

  const outputWidth = Math.min(
    safeMaxSide,
    Math.max(1, Math.round(cropWidth * scale)),
  );
  const outputHeight = Math.min(
    safeMaxSide,
    Math.max(1, Math.round(cropHeight * scale)),
  );

  return {
    sourceOrientedWidth: orientedWidth,
    sourceOrientedHeight: orientedHeight,
    cropWidth,
    cropHeight,
    outputWidth,
    outputHeight,
  };
}

export function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function rotateQuarterTurn(
  current: 0 | 1 | 2 | 3,
  direction: 'left' | 'right',
): 0 | 1 | 2 | 3 {
  if (direction === 'right') {
    return ((current + 1) % 4) as 0 | 1 | 2 | 3;
  }
  return ((current + 3) % 4) as 0 | 1 | 2 | 3;
}

/**
 * Re-codifica el canvas de salida a WebP (calidad 0.85) con respaldo automático a JPEG
 * para navegadores antiguos (ej. Safari iOS previo).
 * NOTA DE PRIVACIDAD: La exportación desde `<canvas>` elimina todos los metadatos EXIF
 * (coordenadas GPS, serie de cámara/teléfono) antes de salir del dispositivo.
 */
export async function exportCanvasToOptimizedBlob(
  canvas: HTMLCanvasElement,
  quality = 0.85,
): Promise<{ blob: Blob; mimeType: 'image/webp' | 'image/jpeg' }> {
  const toBlobPromise = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), type, q);
    });

  let blob = await toBlobPromise('image/webp', quality);
  if (blob && blob.type === 'image/webp') {
    // Si supera 512 KB, reducir calidad automáticamente
    if (blob.size > 512 * 1024) {
      const smaller = await toBlobPromise('image/webp', 0.72);
      if (smaller && smaller.type === 'image/webp') {
        blob = smaller;
      }
    }
    return { blob, mimeType: 'image/webp' };
  }

  // Respaldo JPEG si el navegador no soporta codificación WebP en canvas.toBlob
  const jpegBlob = await toBlobPromise('image/jpeg', quality);
  if (!jpegBlob) {
    throw new Error('No fue posible exportar la imagen desde el editor canvas');
  }
  return { blob: jpegBlob, mimeType: 'image/jpeg' };
}
