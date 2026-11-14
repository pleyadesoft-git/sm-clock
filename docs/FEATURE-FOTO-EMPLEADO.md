# FEATURE-FOTO-EMPLEADO.md — Foto del trabajador

Subir o tomar la foto de un empleado, ajustarla con `<canvas>` (girar y recortar) y guardarla en un bucket privado de Supabase Storage. Máximo **720 px** por lado.

## 1. Requisitos

| # | Requisito |
|---|-----------|
| 1 | Subir con **drag & drop** o con selector de archivo |
| 2 | **Tomar la foto** desde móvil, tablet o computadora (cámara) |
| 3 | Editor con `<canvas>`: **girar** y **recortar** antes de guardar |
| 4 | Resultado final **≤ 720 px** en su lado mayor |
| 5 | Almacenamiento en **bucket de Supabase Storage** (privado) |
| 6 | UI iOS (tokens de `UI-UX-IOS.md`), responsiva, con teclado y lector de pantalla |

## 2. Flujo

```
Elegir origen ──► Editor <canvas> ──► Exportar blob ≤720px ──► POST servidor ──► Storage
 (drop / archivo /   (girar, recortar,    (WebP, JPEG de         (valida, re-codifica,   (bucket privado
  cámara)             zoom, vista previa)  respaldo)              guarda, actualiza BD)   + miniatura)
```

### 2.1 Origen de la imagen
- **Drag & drop** y selector: zona de arrastre con `<input type="file" accept="image/jpeg,image/png,image/webp">`. Aceptar `image/heic` solo si se convierte en cliente; si no, rechazar con mensaje claro.
- **Móvil/tablet**: segundo botón con `<input type="file" accept="image/*" capture="user">` abre la cámara nativa (más fiable que `getUserMedia` en iOS).
- **Computadora (y tablet si se prefiere vista en vivo)**: `navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 } } })` con vista previa en `<video>` y botón "Capturar" que dibuja el fotograma en un `<canvas>`.
  - Requiere **HTTPS** y permiso del usuario; manejar `NotAllowedError`, `NotFoundError` y cámara ocupada.
  - Detener todos los *tracks* al cerrar el editor o capturar (apagar la luz de la cámara).
  - Selector de cámara si hay varias (`enumerateDevices`).
- Límite de entrada: 15 MB y 8000 px por lado antes de procesar (evita agotar memoria en móviles).

### 2.2 Editor `<canvas>`
- Cargar con `createImageBitmap(file, { imageOrientation: "from-image" })` para respetar la orientación EXIF; verificar compatibilidad en navegadores objetivo y tener respaldo con `<img>` + CSS `image-orientation`.
- **Girar**: botones 90° izquierda/derecha y control fino (±45° con deslizador). Aplicar con `ctx.translate/rotate` sobre un canvas de trabajo.
- **Recortar**: marco arrastrable y redimensionable con proporción fija **1:1** (por defecto, ideal para credencial) y opción libre. Gestos táctiles: arrastrar para mover, *pinch* para zoom. Mouse: rueda para zoom.
- Vista previa en vivo y botones **Cancelar / Restablecer / Guardar**.
- Procesar con `OffscreenCanvas` en un Web Worker si está disponible; si no, canvas normal (la imagen de entrada puede ser grande).
- Evitar fugas: `bitmap.close()`, `URL.revokeObjectURL()` y liberar canvases al cerrar.

### 2.3 Exportación (cliente)
1. Calcular el recorte en coordenadas de la imagen original (con rotación aplicada).
2. Escalar para que el **lado mayor ≤ 720 px** (cuadrado 1:1 → máximo 720×720). Nunca ampliar (si el recorte es menor, dejarlo tal cual).
3. `canvas.toBlob(cb, "image/webp", 0.85)`; si el navegador devuelve otro tipo (Safari antiguo), usar `"image/jpeg", 0.85`. Comprobar `blob.type`.
4. Re-codificar con canvas **elimina los metadatos EXIF** (ubicación, dispositivo). Es un efecto deseado; documentarlo.
5. Peso objetivo: ≤ 150 KB. Si excede 512 KB, reducir calidad automáticamente.

## 3. Servidor (no confiar en el cliente)

Endpoint: `POST /api/empleados/[id]/foto` (multipart, un archivo).

Pasos obligatorios:
1. Verificar sesión, rol (`ADMIN_EMPRESA`, `TECNICO_LOCAL`; **no** `NOMINISTA`) y que el empleado pertenece al `tenant_id` del JWT.
2. Limitar el tamaño del cuerpo (≤ 1 MB) y *rate limit* por usuario.
3. Validar el tipo por **firma real del archivo** (*magic bytes*), no por extensión ni por el `Content-Type` declarado.
4. Procesar con `sharp`: leer metadatos, **rechazar** si el lado mayor > 720 px o si no es imagen válida, `rotate()` según EXIF por seguridad, quitar metadatos y **re-codificar** a WebP (o JPEG).
5. Generar miniatura de 128 px (`{id}_thumb.webp`) para tablas y listas.
6. Subir con `service_role` a la ruta `{tenant_id}/{empleado_id}/{uuid}.webp` (nombre nuevo en cada subida para evitar caché obsoleta).
7. Actualizar `empleados.foto_path`, `foto_thumb_path` y `foto_actualizada_en`; **borrar** los archivos anteriores.
8. Registrar en `auditoria` (acción `EMPLEADO_FOTO_ACTUALIZADA`), sin guardar la imagen en logs.

Validar la entrada con Zod (`id` UUID) y devolver errores sin detalles internos.

## 4. Base de datos y Storage

Ver migración en `DATABASE.md` §8. Resumen:
- Columnas en `empleados`: `foto_path`, `foto_thumb_path`, `foto_actualizada_en`.
- Bucket privado `empleados-fotos` con `file_size_limit` de 512 KB y `allowed_mime_types` = `image/webp`, `image/jpeg`.
- Políticas en `storage.objects`: lectura solo para miembros del tenant (primer segmento de la ruta = `tenant_id`); **sin** políticas de escritura para `authenticated` (la escritura la hace el servidor).
- Visualización con **URLs firmadas de corta vida** (p. ej., 10 min) generadas en servidor; nunca bucket público.

## 5. Componente de UI

`<PhotoUploader />` en `components/ui` (o `components/features/empleados`):

| Prop | Descripción |
|------|-------------|
| `empleadoId` | Para el endpoint |
| `value` | URL firmada actual (opcional) |
| `maxSize` | 720 (por defecto) |
| `aspect` | `1` (por defecto) o `free` |
| `onSaved` | Callback con la nueva ruta |

Comportamiento:
- En móvil se abre como **Sheet** a pantalla completa; en desktop como diálogo centrado.
- Estados: vacío, arrastrando (resaltado), cargando, editando, guardando (progreso), error, éxito.
- Mutación con TanStack Query; al terminar invalida `["empleado", id]` y la lista.
- Avatar con iniciales como respaldo cuando no hay foto.
- Accesibilidad: dropzone operable con teclado (Enter/Espacio), botones de giro con `aria-label`, atajos (←/→ para girar 90°), texto alternativo, foco visible, `prefers-reduced-motion`.
- Textos en español: "Arrastra una foto aquí", "Tomar foto", "Girar a la izquierda", "Recortar", "Guardar foto".

## 6. Privacidad
- La foto es un **dato personal**. Usarla solo para identificar visualmente al trabajador en la plataforma y reportes.
- **No** usarla para reconocimiento facial ni extraer plantillas biométricas desde la nube.
- Incluir su tratamiento en el aviso de privacidad y en el contrato de encargado.
- Retención: borrar fotos al eliminar al empleado o al terminar el contrato con el cliente, según la política del tenant.
- Solo `ADMIN_EMPRESA` y `TECNICO_LOCAL` pueden subir o reemplazar; `NOMINISTA` solo ve.
- Cualquier foto incluida en reportes PDF/XLSX debe usar la miniatura y respetar el permiso de rol.

## 7. Pruebas
- **Unitarias**: la función de exportación nunca produce > 720 px; rotación 90/180/270 mantiene dimensiones esperadas; recorte fuera de límites se acota.
- **Servidor**: rechaza archivos > 720 px, tipos falsos (renombrados), cuerpos enormes y usuarios de otro tenant.
- **pgTAP / Storage**: el tenant A no lee ni lista fotos del tenant B; `authenticated` no puede insertar/borrar en el bucket.
- **E2E (Playwright)**: arrastrar archivo, girar, recortar y guardar; flujo de cámara con `--use-fake-device-for-media-stream`.
- **Dispositivos reales**: iOS Safari, Android Chrome, Chrome/Edge/Firefox en escritorio.

## 8. Riesgos y decisiones
- **HEIC (iPhone)**: Safari suele entregar JPEG al usar `capture`; con archivos HEIC elegidos desde la galería puede fallar la decodificación en otros navegadores. Decidir si se convierte o se rechaza con mensaje.
- **Memoria en móviles**: fotos de 12 MP+; por eso el límite de entrada y `OffscreenCanvas`.
- **WebP en Safari antiguo**: respaldo a JPEG obligatorio.
- Verificar en la documentación vigente de Supabase Storage la sintaxis de políticas y límites del bucket antes de implementar.
