'use client';

import * as React from 'react';
import { ExternalLink, MapPin, Navigation } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface LocationMapPreviewProps {
  latitud: number;
  longitud: number;
  titulo?: string;
  subtitulo?: string;
  radioGeocercaM?: number;
  /** Si se provee un segundo punto (p. ej. ubicación de la sucursal vs ubicación del Check-In) */
  sucursalLatitud?: number | null;
  sucursalLongitud?: number | null;
  sucursalNombre?: string | null;
  distanciaMetros?: number | null;
  dentroGeocerca?: boolean | null;
  heightClassName?: string;
}

export function buildGoogleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function buildGoogleMapsCoordUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function buildOpenStreetMapEmbedUrl(
  lat: number,
  lng: number,
  delta = 0.0045,
): string {
  const minLon = (lng - delta).toFixed(6);
  const minLat = (lat - delta).toFixed(6);
  const maxLon = (lng + delta).toFixed(6);
  const maxLat = (lat + delta).toFixed(6);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${lat.toFixed(6)}%2C${lng.toFixed(6)}`;
}

export function LocationMapPreview({
  latitud,
  longitud,
  titulo,
  subtitulo,
  radioGeocercaM,
  sucursalLatitud,
  sucursalLongitud,
  sucursalNombre,
  distanciaMetros,
  dentroGeocerca,
  heightClassName = 'h-56',
}: LocationMapPreviewProps) {
  const embedUrl = React.useMemo(
    () => buildOpenStreetMapEmbedUrl(latitud, longitud),
    [latitud, longitud],
  );
  const gmapsUrl = React.useMemo(
    () => buildGoogleMapsCoordUrl(latitud, longitud),
    [latitud, longitud],
  );

  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-1)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)] border-b border-[var(--border)] bg-[var(--surface-2)] px-[var(--s-3)] py-[var(--s-2)]">
        <div className="flex items-center gap-[var(--s-2)]">
          <div className="flex size-7 items-center justify-center rounded-[var(--r-sm)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <MapPin className="size-4" aria-hidden="true" />
          </div>
          <div>
            {titulo && (
              <p className="text-xs font-semibold text-[var(--text)]">
                {titulo}
              </p>
            )}
            <p className="font-mono text-xs tabular-nums text-[var(--text-2)]">
              {latitud.toFixed(6)}, {longitud.toFixed(6)}
              {subtitulo ? ` · ${subtitulo}` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-[var(--s-2)]">
          {typeof radioGeocercaM === 'number' && (
            <Badge variant="info">Geocerca: {radioGeocercaM} m</Badge>
          )}
          {typeof distanciaMetros === 'number' && (
            <Badge variant={dentroGeocerca ? 'success' : 'warning'}>
              {dentroGeocerca
                ? `En sucursal (${Math.round(distanciaMetros)} m)`
                : `Fuera de geocerca (${
                    distanciaMetros >= 1000
                      ? `${(distanciaMetros / 1000).toFixed(2)} km`
                      : `${Math.round(distanciaMetros)} m`
                  })`}
            </Badge>
          )}
          <a
            href={gmapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-[var(--s-1)] rounded-[var(--r-sm)] bg-[var(--surface)] px-[var(--s-2)] py-[var(--s-1)] text-xs font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
          >
            <span>Google Maps</span>
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className={`relative w-full bg-[var(--surface-2)] ${heightClassName}`}>
        <iframe
          title={titulo ?? `Mapa de ubicación ${latitud}, ${longitud}`}
          src={embedUrl}
          className="size-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      {sucursalLatitud != null && sucursalLongitud != null && (
        <div className="flex flex-wrap items-center justify-between gap-[var(--s-2)] border-t border-[var(--border)] bg-[var(--surface-2)] px-[var(--s-3)] py-[var(--s-2)] text-xs text-[var(--text-2)]">
          <div className="flex items-center gap-[var(--s-2)]">
            <Navigation
              className="size-3.5 text-[var(--accent)]"
              aria-hidden="true"
            />
            <span>
              Sucursal asignada:{' '}
              <strong className="text-[var(--text)]">
                {sucursalNombre ?? 'Planta'}
              </strong>{' '}
              (
              <span className="font-mono tabular-nums">
                {sucursalLatitud.toFixed(5)}, {sucursalLongitud.toFixed(5)}
              </span>
              )
            </span>
          </div>
          <a
            href={`https://www.google.com/maps/dir/${sucursalLatitud.toFixed(6)},${sucursalLongitud.toFixed(6)}/${latitud.toFixed(6)},${longitud.toFixed(6)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--accent)] hover:underline"
          >
            Ver comparativa de ruta en Google Maps →
          </a>
        </div>
      )}
    </div>
  );
}
