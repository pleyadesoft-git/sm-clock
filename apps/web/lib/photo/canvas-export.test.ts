import { describe, expect, it } from 'vitest';
import {
  clampOffset,
  computeExportDimensions,
  MAX_EXPORT_SIDE_PX,
  rotateQuarterTurn,
} from './canvas-export';

describe('Canvas Photo Export Geometry & <=720px Enforcement', () => {
  it('never produces output dimensions larger than 720 px for high-res 12MP photos', () => {
    const dimsSquare = computeExportDimensions(4032, 3024, {
      rotationQuarterTurns: 0,
      fineAngleDeg: 0,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      aspect: '1:1',
    });
    expect(dimsSquare.outputWidth).toBe(720);
    expect(dimsSquare.outputHeight).toBe(720);
    expect(Math.max(dimsSquare.outputWidth, dimsSquare.outputHeight)).toBeLessThanOrEqual(
      MAX_EXPORT_SIDE_PX,
    );

    const dimsFree = computeExportDimensions(4000, 2000, {
      rotationQuarterTurns: 0,
      fineAngleDeg: 0,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      aspect: 'free',
    });
    expect(dimsFree.outputWidth).toBe(720);
    expect(dimsFree.outputHeight).toBe(360);
  });

  it('never enlarges small images whose crop is already <= 720 px', () => {
    const smallDims = computeExportDimensions(500, 400, {
      rotationQuarterTurns: 0,
      fineAngleDeg: 0,
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      aspect: '1:1',
    });
    expect(smallDims.outputWidth).toBe(400);
    expect(smallDims.outputHeight).toBe(400);
  });

  it('swaps oriented dimensions on 90° and 270° rotations and clamps offsets', () => {
    const rot90 = computeExportDimensions(1600, 900, {
      rotationQuarterTurns: 1,
      fineAngleDeg: 10,
      zoom: 1,
      offsetX: 2.5,
      offsetY: -3.0,
      aspect: 'free',
    });
    expect(rot90.sourceOrientedWidth).toBe(900);
    expect(rot90.sourceOrientedHeight).toBe(1600);
    expect(rot90.outputWidth).toBe(405);
    expect(rot90.outputHeight).toBe(720);

    expect(rotateQuarterTurn(0, 'left')).toBe(3);
    expect(rotateQuarterTurn(3, 'right')).toBe(0);
    expect(clampOffset(2.5)).toBe(1);
    expect(clampOffset(-4)).toBe(-1);
  });
});
