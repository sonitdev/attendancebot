import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCaptureTimestamp,
  resolveEvidenceLocationName,
  getGraphemeClusters,
  truncateWithEllipsis,
  wrapField,
} from './watermark.ts';

describe('Watermark Evidence Module', () => {
  describe('formatCaptureTimestamp', () => {
    it('formats date and time as YYYY-MM-DD HH:mm:ss without UTC+7 suffix', () => {
      const date = new Date('2026-10-02T03:04:49Z'); // 10:04:49 in Phnom Penh (UTC+7)
      const formatted = formatCaptureTimestamp(date, 'Asia/Phnom_Penh');
      assert.equal(formatted, '2026-10-02 10:04:49');
      assert.equal(formatted.includes('UTC'), false);
      assert.equal(formatted.includes('LIVE'), false);
    });

    it('respects site timezone parameter', () => {
      const date = new Date('2026-10-02T03:04:49Z');
      const formattedTokyo = formatCaptureTimestamp(date, 'Asia/Tokyo'); // 12:04:49 (UTC+9)
      assert.equal(formattedTokyo, '2026-10-02 12:04:49');
    });

    it('defaults to Asia/Phnom_Penh when timezone is empty', () => {
      const date = new Date('2026-10-02T03:04:49Z');
      const formatted = formatCaptureTimestamp(date, null);
      assert.equal(formatted, '2026-10-02 10:04:49');
    });
  });

  describe('resolveEvidenceLocationName', () => {
    it('prefers assigned site name over project name', () => {
      const result = resolveEvidenceLocationName({
        siteName: 'Vattanac Tower Site B',
        projectName: 'Commercial Construction Group',
      });
      assert.equal(result, 'Vattanac Tower Site B');
    });

    it('falls back to project name only when site name is missing or empty', () => {
      const result = resolveEvidenceLocationName({
        siteName: '',
        projectName: 'Aeon Mall Expansion Project',
      });
      assert.equal(result, 'Aeon Mall Expansion Project');
    });

    it('trims leading/trailing whitespace', () => {
      const result = resolveEvidenceLocationName({
        siteName: '   Koh Pich Site 1   ',
        projectName: 'Urban Core',
      });
      assert.equal(result, 'Koh Pich Site 1');
    });

    it('returns empty string when both are missing', () => {
      const result = resolveEvidenceLocationName({});
      assert.equal(result, '');
    });
  });

  describe('getGraphemeClusters', () => {
    it('preserves Khmer base consonants with sub-consonants and vowels as indivisible clusters', () => {
      // ការដ្ឋាន: កា + រ + ដ្ឋា + ន
      const clusters = getGraphemeClusters('ការដ្ឋាន');
      assert.deepEqual(clusters, ['កា', 'រ', 'ដ្ឋា', 'ន']);
    });

    it('keeps combining diacritics attached to the base glyph', () => {
      // វណ្ណារ៉ា: វ + ណ្ណា + រ៉ា
      const clusters = getGraphemeClusters('វណ្ណារ៉ា');
      assert.equal(clusters.some((c) => c.startsWith('្')), false, 'Coeng must not start isolated');
      assert.equal(clusters.some((c) => c === '៉'), false, 'Diacritic must not be isolated');
    });
  });

  describe('wrapField & truncateWithEllipsis', () => {
    // Mock canvas context measuring text
    const mockCtx = {
      measureText: (str: string) => ({ width: str.length * 8 }),
    } as unknown as CanvasRenderingContext2D;

    it('returns single line when text fits within maxWidth', () => {
      const lines = wrapField('John Smith', 200, 2, mockCtx);
      assert.deepEqual(lines, ['John Smith']);
    });

    it('wraps words safely into at most maxLines', () => {
      // 10 chars * 8 = 80px width
      const lines = wrapField('WordA WordB WordC', 100, 2, mockCtx);
      assert.equal(lines.length <= 2, true);
    });

    it('truncates with ellipsis on the final line without exceeding maxWidth', () => {
      const lines = wrapField('Very Long Worker Name That Exceeds All Available Space', 100, 2, mockCtx);
      assert.equal(lines.length, 2);
      assert.equal(lines[1].endsWith('…'), true);
      assert.equal(mockCtx.measureText(lines[1]).width <= 100, true);
    });
  });
});
