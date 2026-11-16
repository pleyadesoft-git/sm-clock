'use client';

import * as React from 'react';
import {
  Camera,
  Check,
  RotateCcw,
  RotateCw,
  Trash2,
  Upload,
  VideoOff,
  ZoomIn,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useToast } from '@/components/ui/toast';
import {
  clampOffset,
  computeExportDimensions,
  exportCanvasToOptimizedBlob,
  MAX_EXPORT_SIDE_PX,
  MAX_INPUT_FILE_BYTES,
  MAX_INPUT_SIDE_PX,
  rotateQuarterTurn,
  type CropTransform,
} from '@/lib/photo/canvas-export';

export interface StagedPhotoPayload {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface PhotoUploaderProps {
  empleadoId?: string | null;
  nombreEmpleado: string;
  value?: string | null;
  maxSize?: number;
  aspect?: '1:1' | 'free';
  onStagedChange?: (staged: StagedPhotoPayload | null) => void;
  onSaved?: (payload: {
    foto_path: string;
    foto_thumb_path: string;
    signed_url: string | null;
    signed_thumb_url: string | null;
  }) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'EM';
}

export function PhotoUploader({
  empleadoId = null,
  nombreEmpleado,
  value = null,
  maxSize = MAX_EXPORT_SIDE_PX,
  aspect: initialAspect = '1:1',
  onStagedChange,
  onSaved,
}: PhotoUploaderProps) {
  const { toast } = useToast();

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const mobileCaptureInputRef = React.useRef<HTMLInputElement | null>(null);
  const previewCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = React.useRef<MediaStream | null>(null);
  const dragStateRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  } | null>(null);

  const [isDragging, setIsDragging] = React.useState(false);
  const [cameraActive, setCameraActive] = React.useState(false);
  const [videoDevices, setVideoDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = React.useState<string>('');

  const [loadedImage, setLoadedImage] = React.useState<
    HTMLImageElement | ImageBitmap | null
  >(null);
  const [sourceSize, setSourceSize] = React.useState<{
    width: number;
    height: number;
  } | null>(null);

  const [transform, setTransform] = React.useState<CropTransform>({
    rotationQuarterTurns: 0,
    fineAngleDeg: 0,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    aspect: initialAspect,
  });

  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [stagedInfo, setStagedInfo] =
    React.useState<StagedPhotoPayload | null>(null);
  const [currentPreviewUrl, setCurrentPreviewUrl] = React.useState<
    string | null
  >(value);

  React.useEffect(() => {
    if (!stagedInfo) {
      setCurrentPreviewUrl(value);
    }
  }, [value, stagedInfo]);

  React.useEffect(() => {
    return () => {
      if (stagedInfo?.previewUrl) {
        URL.revokeObjectURL(stagedInfo.previewUrl);
      }
    };
  }, [stagedInfo]);

  const stopCameraTracks = React.useCallback(() => {
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  React.useEffect(() => {
    return () => {
      stopCameraTracks();
      if (loadedImage && 'close' in loadedImage) {
        loadedImage.close();
      }
    };
  }, [loadedImage, stopCameraTracks]);

  const drawCanvasPreview = React.useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !loadedImage || !sourceSize) return;

    const dims = computeExportDimensions(
      sourceSize.width,
      sourceSize.height,
      transform,
      maxSize,
    );

    canvas.width = dims.outputWidth;
    canvas.height = dims.outputHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    ctx.translate(canvas.width / 2, canvas.height / 2);
    const totalRadians =
      ((transform.rotationQuarterTurns * 90 + transform.fineAngleDeg) *
        Math.PI) /
      180;
    ctx.rotate(totalRadians);

    const baseScale = Math.max(
      canvas.width / dims.sourceOrientedWidth,
      canvas.height / dims.sourceOrientedHeight,
    );
    const finalScale = baseScale * transform.zoom;
    ctx.scale(finalScale, finalScale);

    const panX = transform.offsetX * (sourceSize.width * 0.25);
    const panY = transform.offsetY * (sourceSize.height * 0.25);

    ctx.drawImage(
      loadedImage,
      -sourceSize.width / 2 + panX,
      -sourceSize.height / 2 + panY,
      sourceSize.width,
      sourceSize.height,
    );
    ctx.restore();
  }, [loadedImage, maxSize, sourceSize, transform]);

  React.useEffect(() => {
    drawCanvasPreview();
  }, [drawCanvasPreview]);

  async function loadFileIntoEditor(file: File) {
    setErrorMsg(null);
    stopCameraTracks();

    if (
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      file.name.toLowerCase().endsWith('.heic')
    ) {
      setErrorMsg(
        'Los archivos HEIC no se decodifican directamente en todos los navegadores. Selecciona una imagen JPEG, PNG o WebP, o usa el botón "Tomar foto".',
      );
      return;
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('Formato no admitido. Usa una imagen JPEG, PNG o WebP.');
      return;
    }

    if (file.size > MAX_INPUT_FILE_BYTES) {
      setErrorMsg('El archivo supera el límite de entrada de 15 MB.');
      return;
    }

    try {
      if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(file, {
          imageOrientation: 'from-image',
        });
        if (
          bitmap.width > MAX_INPUT_SIDE_PX ||
          bitmap.height > MAX_INPUT_SIDE_PX
        ) {
          bitmap.close();
          setErrorMsg(
            `La resolución (${bitmap.width}×${bitmap.height} px) supera el máximo de ${MAX_INPUT_SIDE_PX} px por lado.`,
          );
          return;
        }
        if (loadedImage && 'close' in loadedImage) {
          loadedImage.close();
        }
        setLoadedImage(bitmap);
        setSourceSize({ width: bitmap.width, height: bitmap.height });
      } else {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Error al cargar imagen'));
          img.src = objectUrl;
        });
        URL.revokeObjectURL(objectUrl);
        setLoadedImage(img);
        setSourceSize({ width: img.naturalWidth, height: img.naturalHeight });
      }

      setTransform({
        rotationQuarterTurns: 0,
        fineAngleDeg: 0,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        aspect: initialAspect,
      });
    } catch {
      setErrorMsg('No se pudo abrir la imagen seleccionada.');
    }
  }

  async function startLiveCamera(deviceId?: string) {
    setErrorMsg(null);
    stopCameraTracks();

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setErrorMsg(
        'Tu navegador no permite acceso directo a la cámara o requiere HTTPS.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 } }
          : { facingMode: 'user', width: { ideal: 1280 } },
        audio: false,
      });
      mediaStreamRef.current = stream;
      setCameraActive(true);

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const cams = allDevices.filter((d) => d.kind === 'videoinput');
      setVideoDevices(cams);

      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      if (errName === 'NotAllowedError') {
        setErrorMsg(
          'Permiso de cámara denegado. Habilita el acceso a la cámara en tu navegador.',
        );
      } else if (errName === 'NotFoundError') {
        setErrorMsg('No se detectó ninguna cámara conectada en este equipo.');
      } else {
        setErrorMsg('No se pudo iniciar la cámara (puede estar ocupada).');
      }
    }
  }

  async function captureFrameFromVideo() {
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);

    stopCameraTracks();

    const blob = await new Promise<Blob | null>((resolve) =>
      tempCanvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
    );
    if (blob) {
      const capturedFile = new File([blob], 'captura-camara.jpg', {
        type: 'image/jpeg',
      });
      await loadFileIntoEditor(capturedFile);
    }
  }

  function clearStagedPhoto() {
    setStagedInfo(null);
    setCurrentPreviewUrl(value);
    onStagedChange?.(null);
  }

  async function handleSavePhoto() {
    const canvas = previewCanvasRef.current;
    if (!canvas || !loadedImage) return;

    setIsSaving(true);
    setErrorMsg(null);
    try {
      const { blob, mimeType } = await exportCanvasToOptimizedBlob(
        canvas,
        0.85,
      );
      const ext = mimeType === 'image/webp' ? 'webp' : 'jpg';
      const fileToSend = new File([blob], `empleado.${ext}`, {
        type: mimeType,
      });

      if (!empleadoId) {
        const previewUrl = URL.createObjectURL(fileToSend);
        const staged: StagedPhotoPayload = {
          file: fileToSend,
          previewUrl,
          width: canvas.width,
          height: canvas.height,
          sizeBytes: fileToSend.size,
        };
        setStagedInfo(staged);
        setCurrentPreviewUrl(previewUrl);
        onStagedChange?.(staged);

        if ('close' in loadedImage) {
          loadedImage.close();
        }
        setLoadedImage(null);
        setSourceSize(null);

        toast({
          title: 'Fotografía lista',
          description: `Recortada a ${canvas.width}×${canvas.height} px. Se subirá al crear el empleado.`,
          variant: 'success',
        });
        return;
      }

      const formData = new FormData();
      formData.append('file', fileToSend);

      const res = await fetch(`/api/empleados/${empleadoId}/foto`, {
        method: 'POST',
        body: formData,
      });

      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        foto_path?: string;
        foto_thumb_path?: string;
        signed_url?: string | null;
        signed_thumb_url?: string | null;
      };

      if (!res.ok || !json.foto_path) {
        setErrorMsg(json.error ?? 'Error al guardar la fotografía');
        return;
      }

      if (json.signed_url) {
        setCurrentPreviewUrl(json.signed_url);
      }

      if ('close' in loadedImage) {
        loadedImage.close();
      }
      setLoadedImage(null);
      setSourceSize(null);

      toast({
        title: 'Fotografía actualizada',
        description:
          'Se guardó en el bucket privado (≤ 720 px, sin metadatos EXIF).',
        variant: 'success',
      });

      onSaved?.({
        foto_path: json.foto_path,
        foto_thumb_path: json.foto_thumb_path ?? json.foto_path,
        signed_url: json.signed_url ?? null,
        signed_thumb_url: json.signed_thumb_url ?? null,
      });
    } catch {
      setErrorMsg('Error al procesar o subir la fotografía.');
    } finally {
      setIsSaving(false);
    }
  }

  function handleKeyDownEditor(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!loadedImage) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setTransform((prev) => ({
        ...prev,
        rotationQuarterTurns: rotateQuarterTurn(
          prev.rotationQuarterTurns,
          'left',
        ),
      }));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setTransform((prev) => ({
        ...prev,
        rotationQuarterTurns: rotateQuarterTurn(
          prev.rotationQuarterTurns,
          'right',
        ),
      }));
    }
  }

  return (
    <div
      className="flex flex-col gap-[var(--s-4)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface-2)] p-[var(--s-4)]"
      onKeyDown={handleKeyDownEditor}
    >
      {/* Cabecera con avatar actual */}
      <div className="flex items-center justify-between gap-[var(--s-3)]">
        <div className="flex items-center gap-[var(--s-3)]">
          {currentPreviewUrl ? (
            <img
              src={currentPreviewUrl}
              alt={`Fotografía de ${nombreEmpleado}`}
              className="size-14 shrink-0 rounded-full border border-[var(--separator)] object-cover"
            />
          ) : (
            <div
              aria-label={`Iniciales de ${nombreEmpleado}`}
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] font-semibold text-[var(--primary)]"
            >
              {getInitials(nombreEmpleado)}
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-[var(--text)]">
              Fotografía del trabajador
            </span>
            <span className="text-xs text-[var(--text-2)]">
              Máximo 720 px por lado · Almacenamiento privado sin EXIF
            </span>
            {stagedInfo && !loadedImage ? (
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-[var(--success-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--success)]">
                <Check className="size-3" aria-hidden="true" />
                Lista · {stagedInfo.width}×{stagedInfo.height} px ·{' '}
                {Math.max(1, Math.round(stagedInfo.sizeBytes / 1024))} KB
              </span>
            ) : null}
          </div>
        </div>

        {stagedInfo && !loadedImage ? (
          <Button
            type="button"
            variant="plain"
            onClick={clearStagedPhoto}
            aria-label="Quitar fotografía seleccionada"
            className="text-xs text-[var(--danger)]"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>Quitar</span>
          </Button>
        ) : null}
      </div>

      {/* Inputs ocultos de archivo y captura nativa móvil */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFileIntoEditor(f);
          e.target.value = '';
        }}
      />
      <input
        ref={mobileCaptureInputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFileIntoEditor(f);
          e.target.value = '';
        }}
      />

      {/* Zona Drag & Drop + Botones de cámara cuando no se está editando */}
      {!loadedImage && !cameraActive && (
        <div className="flex flex-col gap-[var(--s-3)]">
          <div
            role="button"
            tabIndex={0}
            aria-label="Arrastra una foto aquí o presiona Enter para elegir un archivo"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void loadFileIntoEditor(f);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-[var(--s-2)] rounded-[var(--r-lg)] border-2 border-dashed p-[var(--s-5)] text-center transition-colors ${
              isDragging
                ? 'border-[var(--primary)] bg-[var(--primary-soft)]'
                : 'border-[var(--separator)] bg-[var(--surface)] hover:border-[var(--primary)]'
            }`}
          >
            <Upload
              className="size-6 text-[var(--primary)]"
              aria-hidden="true"
            />
            <span className="text-sm font-semibold text-[var(--text)]">
              Arrastra una foto aquí
            </span>
            <span className="text-xs text-[var(--text-2)]">
              O haz clic para seleccionar JPEG, PNG o WebP (máx. 15 MB)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-[var(--s-2)]">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void startLiveCamera()}
            >
              <Camera className="size-4" aria-hidden="true" />
              Tomar foto (Cámara web)
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => mobileCaptureInputRef.current?.click()}
            >
              <Camera className="size-4" aria-hidden="true" />
              Cámara móvil / tablet
            </Button>
          </div>
        </div>
      )}

      {/* Vista en vivo de cámara web */}
      {cameraActive && (
        <div className="flex flex-col gap-[var(--s-3)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-3)]">
          {videoDevices.length > 1 && (
            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="camera-device-select" className="ios-label">
                Seleccionar cámara
              </label>
              <select
                id="camera-device-select"
                value={selectedDeviceId}
                onChange={(e) => {
                  setSelectedDeviceId(e.target.value);
                  void startLiveCamera(e.target.value);
                }}
                className="ios-input w-full px-[var(--s-3)] text-sm"
              >
                {videoDevices.map((dev, idx) => (
                  <option key={dev.deviceId} value={dev.deviceId}>
                    {dev.label || `Cámara ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-64 w-full rounded-[var(--r-md)] bg-black object-contain"
          />

          <div className="flex justify-end gap-[var(--s-2)]">
            <Button
              type="button"
              variant="secondary"
              onClick={stopCameraTracks}
            >
              <VideoOff className="size-4" aria-hidden="true" />
              Cancelar cámara
            </Button>
            <Button type="button" onClick={() => void captureFrameFromVideo()}>
              <Camera className="size-4" aria-hidden="true" />
              Capturar fotograma
            </Button>
          </div>
        </div>
      )}

      {/* Editor <canvas>: girar, recortar y guardar */}
      {loadedImage && sourceSize && (
        <div className="flex flex-col gap-[var(--s-4)] rounded-[var(--r-lg)] border border-[var(--separator)] bg-[var(--surface)] p-[var(--s-4)]">
          <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)]">
            <span className="text-xs font-semibold text-[var(--text)]">
              Recortar y girar antes de guardar (≤ {maxSize} px)
            </span>
            <SegmentedControl<'1:1' | 'free'>
              ariaLabel="Proporción de recorte"
              value={transform.aspect}
              onChange={(aspect) =>
                setTransform((prev) => ({ ...prev, aspect }))
              }
              options={[
                { value: '1:1', label: 'Credencial 1:1' },
                { value: 'free', label: 'Libre' },
              ]}
            />
          </div>

          <div className="flex flex-col items-center justify-center gap-[var(--s-1)] overflow-hidden rounded-[var(--r-md)] bg-[var(--bg-elevated)] p-[var(--s-3)]">
            <canvas
              ref={previewCanvasRef}
              aria-label="Vista previa de recorte y rotación de la fotografía"
              className="max-h-64 max-w-full cursor-grab touch-none rounded-[var(--r-sm)] border border-[var(--separator)] shadow-[var(--shadow-1)] active:cursor-grabbing"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                dragStateRef.current = {
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startY: e.clientY,
                  origOffsetX: transform.offsetX,
                  origOffsetY: transform.offsetY,
                };
              }}
              onPointerMove={(e) => {
                const drag = dragStateRef.current;
                if (!drag || drag.pointerId !== e.pointerId) return;
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                const dx = ((e.clientX - drag.startX) / rect.width) * 2;
                const dy = ((e.clientY - drag.startY) / rect.height) * 2;
                setTransform((prev) => ({
                  ...prev,
                  offsetX: clampOffset(drag.origOffsetX + dx),
                  offsetY: clampOffset(drag.origOffsetY + dy),
                }));
              }}
              onPointerUp={(e) => {
                if (dragStateRef.current?.pointerId === e.pointerId) {
                  dragStateRef.current = null;
                }
              }}
              onPointerCancel={(e) => {
                if (dragStateRef.current?.pointerId === e.pointerId) {
                  dragStateRef.current = null;
                }
              }}
              onWheel={(e) => {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.1 : -0.1;
                setTransform((prev) => ({
                  ...prev,
                  zoom: Math.min(3, Math.max(1, Number((prev.zoom + delta).toFixed(2)))),
                }));
              }}
            />
            <span className="text-[11px] text-[var(--text-2)]">
              Arrastra sobre la imagen para encuadrar · Usa la rueda o deslizadores para zoom
            </span>
          </div>

          {/* Botones de giro de 90° */}
          <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)]">
            <div className="flex items-center gap-[var(--s-2)]">
              <Button
                type="button"
                variant="secondary"
                aria-label="Girar a la izquierda"
                onClick={() =>
                  setTransform((prev) => ({
                    ...prev,
                    rotationQuarterTurns: rotateQuarterTurn(
                      prev.rotationQuarterTurns,
                      'left',
                    ),
                  }))
                }
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Girar a la izquierda
              </Button>
              <Button
                type="button"
                variant="secondary"
                aria-label="Girar a la derecha"
                onClick={() =>
                  setTransform((prev) => ({
                    ...prev,
                    rotationQuarterTurns: rotateQuarterTurn(
                      prev.rotationQuarterTurns,
                      'right',
                    ),
                  }))
                }
              >
                <RotateCw className="size-4" aria-hidden="true" />
                Girar a la derecha
              </Button>
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setTransform({
                  rotationQuarterTurns: 0,
                  fineAngleDeg: 0,
                  zoom: 1,
                  offsetX: 0,
                  offsetY: 0,
                  aspect: initialAspect,
                })
              }
            >
              Restablecer
            </Button>
          </div>

          {/* Deslizadores de giro fino (±45°) y zoom (1x-3x) */}
          <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="fine-angle-range" className="ios-label">
                Ángulo fino ({transform.fineAngleDeg}°)
              </label>
              <input
                id="fine-angle-range"
                type="range"
                min={-45}
                max={45}
                step={1}
                value={transform.fineAngleDeg}
                onChange={(e) =>
                  setTransform((prev) => ({
                    ...prev,
                    fineAngleDeg: Number(e.target.value),
                  }))
                }
              />
            </div>

            <div className="flex flex-col gap-[var(--s-1)]">
              <label
                htmlFor="zoom-range"
                className="ios-label inline-flex items-center gap-[var(--s-1)]"
              >
                <ZoomIn className="size-3.5" aria-hidden="true" />
                Acercamiento ({transform.zoom.toFixed(1)}×)
              </label>
              <input
                id="zoom-range"
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={transform.zoom}
                onChange={(e) =>
                  setTransform((prev) => ({
                    ...prev,
                    zoom: Number(e.target.value),
                  }))
                }
              />
            </div>
          </div>

          {/* Deslizadores de encuadre X / Y */}
          <div className="grid grid-cols-1 gap-[var(--s-3)] sm:grid-cols-2">
            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="pan-x-range" className="ios-label">
                Encuadre horizontal
              </label>
              <input
                id="pan-x-range"
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={transform.offsetX}
                onChange={(e) =>
                  setTransform((prev) => ({
                    ...prev,
                    offsetX: clampOffset(Number(e.target.value)),
                  }))
                }
              />
            </div>

            <div className="flex flex-col gap-[var(--s-1)]">
              <label htmlFor="pan-y-range" className="ios-label">
                Encuadre vertical
              </label>
              <input
                id="pan-y-range"
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={transform.offsetY}
                onChange={(e) =>
                  setTransform((prev) => ({
                    ...prev,
                    offsetY: clampOffset(Number(e.target.value)),
                  }))
                }
              />
            </div>
          </div>

          <div className="flex justify-end gap-[var(--s-2)] pt-[var(--s-2)]">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (loadedImage && 'close' in loadedImage) {
                  loadedImage.close();
                }
                setLoadedImage(null);
                setSourceSize(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isSaving}
              onClick={() => void handleSavePhoto()}
            >
              <Check className="size-4" aria-hidden="true" />
              <span>
                {isSaving
                  ? empleadoId
                    ? 'Guardando foto…'
                    : 'Procesando imagen…'
                  : empleadoId
                    ? 'Confirmar y guardar foto'
                    : `Confirmar imagen (≤ ${maxSize} px)`}
              </span>
            </Button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-[var(--r-md)] bg-[var(--danger-bg)] px-[var(--s-3)] py-[var(--s-2)] text-xs font-medium text-[var(--danger)]"
        >
          {errorMsg}
        </div>
      )}
    </div>
  );
}
