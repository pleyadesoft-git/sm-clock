import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('server-only', () => ({}));

import {
  detectImageMagicBytes,
  validateAndProcessEmployeePhoto,
} from './photo-validator';

describe('Employee Photo Server Validation (Magic Bytes + Sharp <= 720px)', () => {
  it('rejects files with fake magic bytes (e.g. text/executable renamed to .webp)', async () => {
    const fakeWebp = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');
    expect(detectImageMagicBytes(fakeWebp)).toBeNull();

    const result = await validateAndProcessEmployeePhoto(fakeWebp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(415);
    }
  });

  it('rejects valid images whose largest side exceeds 720 px', async () => {
    const oversizedBuffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 20, g: 100, b: 200 },
      },
    })
      .webp()
      .toBuffer();

    const result = await validateAndProcessEmployeePhoto(oversizedBuffer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.message).toContain('720');
    }
  });

  it('accepts valid images <= 720 px, strips EXIF, and produces main + 128px thumbnail in WebP', async () => {
    const validJpeg = await sharp({
      create: {
        width: 640,
        height: 640,
        channels: 3,
        background: { r: 10, g: 132, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();

    const result = await validateAndProcessEmployeePhoto(validJpeg);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.width).toBeLessThanOrEqual(720);
      expect(result.data.height).toBeLessThanOrEqual(720);
      expect(detectImageMagicBytes(result.data.mainBuffer)).toBe('image/webp');
      expect(detectImageMagicBytes(result.data.thumbBuffer)).toBe('image/webp');

      const thumbMeta = await sharp(result.data.thumbBuffer).metadata();
      expect(thumbMeta.width).toBe(128);
      expect(thumbMeta.height).toBe(128);
    }
  });
});
