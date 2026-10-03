/**
 * Attendance evidence photo watermark renderer.
 *
 * Restrained, Japanese-industrial-inspired label:
 * - Quiet, medium-weight typography (Roboto Flex + Kantumruy Pro)
 * - Three left-aligned rows: Worker Name, Capture Timestamp (YYYY-MM-DD HH:mm:ss), Site/Location Name
 * - Compact, flat, translucent charcoal footer
 * - Grapheme-safe wrapping and ellipsis (never splits Khmer combining characters or Coeng subscripts)
 * - Measured text sizing (not hardcoded guesses)
 * - Authoritative server timestamps remain authoritative; this client evidence photo is strictly evidence.
 */

export type WatermarkEvidence = {
  workerName?: string | null;
  siteName?: string | null;
  projectName?: string | null;
  timezone?: string | null;
  capturedAt?: Date;
};

export type RenderEvidenceOptions = {
  maxDim?: number;
  quality?: number;
};

/**
 * Format client evidence timestamp as `YYYY-MM-DD HH:mm:ss` in the assigned site timezone.
 * Removes hardcoded UTC+7 suffix, badges, and emojis.
 */
export function formatCaptureTimestamp(date: Date, timezone?: string | null): string {
  const tz = timezone || 'Asia/Phnom_Penh';
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  return `${dateStr} ${timeStr}`;
}

/**
 * Resolves location display name: uses assigned site name first,
 * falling back to project name only if site name is unavailable.
 */
export function resolveEvidenceLocationName(params: {
  siteName?: string | null;
  projectName?: string | null;
}): string {
  const site = params.siteName?.trim();
  if (site) return site;
  const project = params.projectName?.trim();
  if (project) return project;
  return '';
}

let fontsLoadedPromise: Promise<void> | null = null;

/**
 * Preload the official project fonts before drawing onto HTML5 Canvas.
 * Canvas fallback fonts cause glyph misalignments and broken Khmer shaping.
 */
export async function ensureWatermarkFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    return;
  }
  if (!fontsLoadedPromise) {
    fontsLoadedPromise = (async () => {
      try {
        await Promise.allSettled([
          document.fonts.load('500 16px "Roboto Flex"'),
          document.fonts.load('500 16px "Kantumruy Pro"'),
          document.fonts.ready,
        ]);
      } catch (err) {
        console.warn('[watermark] Failed to preload watermark fonts:', err);
      }
    })();
  }
  await fontsLoadedPromise;
}

/**
 * Returns grapheme clusters for a string.
 * Using UAX #29 extended grapheme clusters prevents breaking Khmer combining marks,
 * subscripts (Coeng), and surrogate pairs.
 */
export function getGraphemeClusters(text: string, locale = 'km'): string[] {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'grapheme' });
    const clusters: string[] = [];
    for (const seg of segmenter.segment(text)) {
      clusters.push(seg.segment);
    }
    return clusters;
  }
  // Fallback regex preserving surrogate pairs and Khmer combining clusters
  const regex = /[\u1780-\u17D3\u17D4-\u17DD]+|[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\s]|\s+/g;
  return text.match(regex) || Array.from(text);
}

/**
 * Segments text into words/tokens for wrapping.
 */
function segmentIntoWords(text: string, locale = 'km'): string[] {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' });
    const words: string[] = [];
    for (const seg of segmenter.segment(text)) {
      words.push(seg.segment);
    }
    return words;
  }
  return text.split(/(\s+)/).filter(Boolean);
}

/**
 * Grapheme-safe truncation appending an ellipsis without severing combining sequences.
 */
export function truncateWithEllipsis(
  text: string,
  maxWidth: number,
  ctx: CanvasRenderingContext2D,
  ellipsis = '…'
): string {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  const ellipsisWidth = ctx.measureText(ellipsis).width;
  const targetWidth = maxWidth - ellipsisWidth;
  if (targetWidth <= 0) return ellipsis;

  const graphemes = getGraphemeClusters(text);
  let low = 0;
  let high = graphemes.length;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = graphemes.slice(0, mid).join('');
    const w = ctx.measureText(candidate).width;
    if (w <= targetWidth) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const prefix = graphemes.slice(0, best).join('').trimEnd();
  return prefix ? prefix + ellipsis : ellipsis;
}

/**
 * Wraps or truncates a field safely into at most `maxLines`.
 */
export function wrapField(
  text: string,
  maxWidth: number,
  maxLines: number,
  ctx: CanvasRenderingContext2D
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (ctx.measureText(trimmed).width <= maxWidth) {
    return [trimmed];
  }

  const words = segmentIntoWords(trimmed);
  const lines: string[] = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const testLine = currentLine + word;

    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (lines.length + 1 >= maxLines) {
        // Last allowed line: append remaining text and truncate with ellipsis
        const remaining = words.slice(i).join('');
        const lineWithRemaining = currentLine + remaining;
        lines.push(truncateWithEllipsis(lineWithRemaining, maxWidth, ctx));
        return lines;
      }

      if (currentLine.trim()) {
        lines.push(currentLine.trimEnd());
        currentLine = word.trimStart();
      } else {
        // Single token wider than maxWidth: break by grapheme clusters
        const graphemes = getGraphemeClusters(word);
        let chunk = '';
        for (const g of graphemes) {
          if (ctx.measureText(chunk + g).width <= maxWidth) {
            chunk += g;
          } else {
            lines.push(chunk);
            chunk = g;
            if (lines.length + 1 >= maxLines) break;
          }
        }
        currentLine = chunk;
      }
    }
  }

  if (currentLine.trim()) {
    if (lines.length >= maxLines) {
      lines[lines.length - 1] = truncateWithEllipsis(lines[lines.length - 1] + currentLine, maxWidth, ctx);
    } else {
      lines.push(currentLine.trimEnd());
    }
  }

  return lines;
}

/**
 * Draw a clean, Japanese-industrial watermark onto the given canvas.
 */
export async function burnEvidenceWatermark(
  canvas: HTMLCanvasElement,
  evidence: WatermarkEvidence
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  await ensureWatermarkFontsLoaded();

  const width = canvas.width;
  const height = canvas.height;
  const minDim = Math.min(width, height);

  // Restrained font size: scaled to image dimension, clamped between 13px and 18px
  const fontSize = Math.max(13, Math.min(18, Math.round(minDim * 0.022)));
  // Adequate line-height for Khmer vowels and subscripts (line-height ~1.58)
  const lineHeight = Math.round(fontSize * 1.58);
  const paddingX = Math.max(16, Math.round(width * 0.035));
  const paddingY = Math.max(12, Math.round(fontSize * 0.75));
  const maxWidth = Math.max(60, width - paddingX * 2);

  const fontFamily = '"Roboto Flex", "Kantumruy Pro", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.font = `500 ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const workerName = evidence.workerName?.trim() || '';
  const timestampStr = formatCaptureTimestamp(evidence.capturedAt || new Date(), evidence.timezone);
  const locationName = resolveEvidenceLocationName({
    siteName: evidence.siteName,
    projectName: evidence.projectName,
  });

  // Prepare individual rows: each field gets its own non-overlapping row(s)
  // Field 1: Worker name (max 2 lines if long)
  const workerLines = workerName ? wrapField(workerName, maxWidth, 2, ctx) : [];

  // Field 2: Capture date & time (1 line)
  const timestampLines = [timestampStr];

  // Field 3: Site/location name (max 2 lines if long)
  const locationLines = locationName ? wrapField(locationName, maxWidth, 2, ctx) : [];

  const allLines: string[] = [
    ...workerLines,
    ...timestampLines,
    ...locationLines,
  ];

  // Footer height is derived from measured text, not fixed arbitrary numbers
  const totalTextHeight = allLines.length * lineHeight;
  const bannerHeight = paddingY * 2 + totalTextHeight;
  const bannerY = height - bannerHeight;

  // Compact, flat, translucent charcoal footer (no gradients, no accent lines)
  ctx.fillStyle = 'rgba(18, 22, 25, 0.78)';
  ctx.fillRect(0, bannerY, width, bannerHeight);

  // Render white text with quiet typography
  ctx.fillStyle = '#ffffff';
  ctx.font = `500 ${fontSize}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  for (let i = 0; i < allLines.length; i++) {
    const lineY = bannerY + paddingY + i * lineHeight;
    ctx.fillText(allLines[i], paddingX, lineY);
  }
}

/**
 * Reusable helper for both camera-capture and fallback-photo call sites.
 * Scales image preserving aspect ratio up to `maxDim`, draws onto canvas,
 * burns the evidence watermark, and returns the JPEG data URL.
 */
export async function renderEvidencePhoto(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  evidence: WatermarkEvidence,
  options?: RenderEvidenceOptions
): Promise<string> {
  const maxDim = options?.maxDim ?? 800;
  const quality = options?.quality ?? 0.68;

  let width = sourceWidth;
  let height = sourceHeight;
  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, 0, width, height);
    await burnEvidenceWatermark(canvas, evidence);
  }

  return canvas.toDataURL('image/jpeg', quality);
}
