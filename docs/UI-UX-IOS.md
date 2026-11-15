# UI-UX-IOS.md — Sistema de diseño "iOS-like"

Objetivo: se siente iOS (claridad, profundidad, movimiento sutil), 100 % responsivo, tablas potentes, dashboard en vivo.

## 1. Tokens (único lugar con valores crudos: `apps/web/app/globals.css`)

```css
:root {
  /* Color */
  --bg: #f2f2f7;               /* systemGroupedBackground */
  --surface: #ffffff;
  --surface-2: #f9f9fb;
  --text: #1c1c1e;
  --text-2: #6c6c70;
  --separator: rgb(60 60 67 / 0.18);
  --accent: #007aff;
  --accent-2: #0a84ff;
  --success: #34c759;
  --warning: #ff9f0a;
  --danger: #ff3b30;

  /* Gradientes sutiles (botones) */
  --grad-primary: linear-gradient(180deg, #2b8cff 0%, #007aff 100%);
  --grad-danger:  linear-gradient(180deg, #ff5a50 0%, #ff3b30 100%);
  --grad-neutral: linear-gradient(180deg, #ffffff 0%, #f2f2f7 100%);

  /* Radios (continuos tipo iOS) */
  --r-sm: 10px; --r-md: 14px; --r-lg: 20px; --r-xl: 28px;

  /* Espaciado: escala de 4 px */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px;
  --s-5: 20px; --s-6: 24px; --s-8: 32px; --s-10: 40px;

  /* Sombras suaves */
  --shadow-1: 0 1px 2px rgb(0 0 0 / .06), 0 1px 1px rgb(0 0 0 / .04);
  --shadow-2: 0 8px 24px rgb(0 0 0 / .08);

  --blur: saturate(180%) blur(20px);   /* materiales translúcidos */
  --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
}
.dark {
  --bg: #000000; --surface: #1c1c1e; --surface-2: #2c2c2e;
  --text: #ffffff; --text-2: #98989f;
  --separator: rgb(84 84 88 / 0.45);
  --accent: #0a84ff;
}
```

Modo oscuro obligatorio desde el día uno. Cumplir contraste AA.
Fuente: SF Pro no es redistribuible en web; usar `-apple-system` con respaldo **Inter**.

## 2. Principios
1. **Escala de 4 px.** Márgenes de página: 16 (móvil) / 24 (tablet) / 32 (desktop). Gap entre tarjetas: 16. Padding interno de tarjeta: 16-20.
2. **Tarjetas agrupadas** (`--surface` sobre `--bg`), radio 20, sombra `--shadow-1`, separadores de 0.5 px.
3. **Botones**: alto 44 px mínimo (área táctil), radio 14, texto 17/600. Gradiente **vertical de bajo contraste** (±6 % de luminosidad), sin brillos ni bordes marcados. Estado *pressed*: `scale(.98)` y oscurecer 6 %.
4. **Navegación**: móvil = tab bar inferior translúcida (máx. 5) y títulos grandes que colapsan; desktop = sidebar translúcida + barra superior.
5. **Hojas** (sheets) en lugar de modales en móvil; popovers en desktop. Todo diálogo, modal o drawer con acciones de guardado cuenta obligatoriamente con pie fijo (`.ios-sheet-footer` / `footer` prop) para que los botones de acción nunca queden ocultos por scroll.
6. **Movimiento** (Motion): resortes `{type:"spring", stiffness:400, damping:34}`; entradas de 180-260 ms; respetar `prefers-reduced-motion`.
7. **Iconos**: Lucide, trazo 1.75, tamaño 20/24. **Estados vacíos, carga (skeleton) y error** obligatorios en cada vista.
8. `env(safe-area-inset-*)` en barras fijas; PWA instalable.

## 3. Componentes (`components/ui`, base shadcn personalizada con los tokens)
`Button` (primary/secondary/destructive/plain), `Card`, `List`/`ListItem`, `Input`, `Form` (`FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`), `SegmentedControl`, `Switch`, `Sheet`, `Popover`, `Toast`, `Badge`, `Tabs`, `Skeleton`, `EmptyState`, `StatCard`, `DataTable`, `ChartCard`, `Avatar`, `PhotoUploader` (drag & drop, cámara, editor canvas; ver `docs/FEATURE-FOTO-EMPLEADO.md`).
No agregar un componente nuevo si existe uno equivalente. Prohibido hex/px sueltos en componentes (usar tokens/clases).

## 4. `<DataTable>` estándar (TanStack Table + Query)

Requisitos obligatorios:
- **Encabezados sticky** (`position: sticky; top: 0`) con fondo translúcido y separador; primera columna sticky en horizontal.
- **Búsqueda** global con *debounce* 300 ms.
- **Filtros** por columna (texto, select, rango de fechas, multiselección) con chips visibles y "Limpiar".
- **Ordenamiento** por columna, **paginación del lado del servidor** (cursor/keyset en tablas grandes), selector de tamaño.
- **Visibilidad de columnas** y densidad (cómoda/compacta).
- **Exportar**: XLSX, CSV, PDF respetando filtros y orden actuales.
  - Exportaciones grandes (>10k filas) → job en el worker con notificación y descarga firmada.
  - PDF membretado con razón social y logo del tenant.
  - Neutralizar fórmulas en XLSX/CSV (ver `SECURITY.md`).
- Filas en vivo: nuevas filas entran con animación sutil; no reordenar bajo el cursor del usuario.
- Responsivo: en <640 px cada fila se convierte en tarjeta (lista agrupada), sin scroll horizontal.
- Accesibilidad: roles ARIA de tabla, foco visible, navegación con teclado.

## 5. Dashboard (en vivo y responsivo)

Cuadrícula: 1 columna (móvil) → 2 (tablet) → 4/12 (desktop).

**Cliente (empresa):**
- Tarjetas: presentes ahora, retardos hoy, faltas hoy, checadas última hora, estado de relojes/agente (en línea / sin latido).
- Gráficas: checadas por hora (hoy vs. promedio), asistencia por departamento, tendencia de retardos 30 días, estado de envíos a nómina (pendiente/enviado/error).
- Feed de actividad en vivo (últimas checadas).

**Admin (SaaS):** MRR, clientes por estatus, saldo vencido por antigüedad, agentes caídos, errores de envío, altas por mes.

Reglas de gráficas:
- Recharts (o similar) con colores desde tokens; paleta accesible, no depender solo del color.
- Rango de fechas global y zona horaria del tenant.
- Actualización por Realtime → invalida queries de TanStack Query (no re-render masivo; throttle 1 s).
- Cada gráfica con skeleton, estado vacío y tooltip claro.

## 6. Responsivo (breakpoints)
`sm 640 · md 768 · lg 1024 · xl 1280`. Diseñar **mobile-first**. Probar en 360, 390, 768, 1024, 1440 px. Sin scroll horizontal de página; tablas con scroll contenido o modo tarjeta.

## 7. Tiempo real en UI
Indicador "En vivo" (punto verde) / "Reconectando…" (ámbar). Al reconectar, refetch completo de queries visibles. Mutaciones optimistas solo para acciones simples (marcar, filtrar); datos de checadas siempre desde servidor.

## 8. Contenido
Español es-MX, tono claro y breve. Fechas `dd/MM/yyyy HH:mm`, moneda `$1,234.00 MXN`. Mensajes de error accionables.

## 9. Checklist por pantalla
- [ ] Móvil, tablet, desktop
- [ ] Oscuro y claro
- [ ] Carga, vacío, error
- [ ] Teclado y lector de pantalla
- [ ] Sin valores crudos de color/espaciado
- [ ] Tablas con `<DataTable>` (sticky, búsqueda, filtros, export)

## 10. CSS Validaciones y Formularios
- No utilizar validaciones nativas de HTML en inputs (`required`, `pattern`, `minlength`, etc.); usar siempre `noValidate` en los elementos `<form>`.
- Utilizar la librería `react-hook-form` con esquemas `zod` (`@hookform/resolvers/zod`) y componentes `<Form>` de Shadcn (`components/ui/form`).
- La validación de error solo debe mostrarse una vez que el campo tenga la propiedad `dirty` (`isDirty: true`, modificado por el usuario) o se intente enviar el formulario (`isSubmitted: true`).
- El estado de error visual se presenta exclusivamente con `input[aria-invalid="true"] { border-color: var(--danger); }` (nunca con `input:invalid` nativo para evitar campos rojos al cargar), `<FormLabel>` en rojo (`text-[var(--danger)]`) y `<FormMessage>` (`text-xs font-medium text-[var(--danger)]`).
