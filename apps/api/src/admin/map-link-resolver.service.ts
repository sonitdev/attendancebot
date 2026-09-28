import { BadRequestException, Injectable } from '@nestjs/common';

export interface ResolvedMapLocation {
  latitude: number;
  longitude: number;
  resolvedUrl: string;
}

const MAX_REDIRECTS = 5;
const MAP_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'www.google.com', 'google.com']);

function isTrustedGoogleMapsUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || !MAP_HOSTS.has(url.hostname)) return false;
  return url.hostname === 'maps.app.goo.gl' || url.hostname === 'goo.gl' || url.pathname.startsWith('/maps');
}

function decimalFromDms(degrees: number, minutes: number, seconds: number, hemisphere: string): number {
  const value = degrees + minutes / 60 + seconds / 3600;
  return hemisphere === 'S' || hemisphere === 'W' ? -value : value;
}

export function extractCoordinates(value: string): Pick<ResolvedMapLocation, 'latitude' | 'longitude'> | null {
  const decoded = decodeURIComponent(value).replace(/[\u2010-\u2015\u2212]/g, '-');
  const decimalPatterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /(?:[?&](?:q|ll|query)=|\/place\/)(-?\d+(?:\.\d+)?)(?:,|%2C|\+|\s+)(-?\d+(?:\.\d+)?)/i,
  ];

  for (const pattern of decimalPatterns) {
    const match = decoded.match(pattern);
    if (match) {
      const latitude = Number(match[1]);
      const longitude = Number(match[2]);
      if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
        return { latitude, longitude };
      }
    }
  }

  // Google Maps may encode a pin as 11°34'19.6"N 104°53'44.0"E.
  const dms = decoded.match(
    /(\d{1,2})°(\d{1,2})['′](\d+(?:\.\d+)?)\s*["″]?\s*([NS])[^\d]+(\d{1,3})°(\d{1,2})['′](\d+(?:\.\d+)?)\s*["″]?\s*([EW])/i,
  );
  if (dms) {
    return {
      latitude: decimalFromDms(Number(dms[1]), Number(dms[2]), Number(dms[3]), dms[4]!.toUpperCase()),
      longitude: decimalFromDms(Number(dms[5]), Number(dms[6]), Number(dms[7]), dms[8]!.toUpperCase()),
    };
  }

  return null;
}

@Injectable()
export class MapLinkResolverService {
  async resolve(input: string): Promise<ResolvedMapLocation> {
    let current: URL;
    try {
      current = new URL(input.trim());
    } catch {
      throw new BadRequestException('INVALID_MAP_LINK');
    }

    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
      if (!isTrustedGoogleMapsUrl(current)) {
        throw new BadRequestException('UNSUPPORTED_MAP_LINK');
      }

      const directCoordinates = extractCoordinates(current.toString());
      if (directCoordinates) {
        return { ...directCoordinates, resolvedUrl: current.toString() };
      }

      let response: Response;
      try {
        response = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        throw new BadRequestException('MAP_LINK_UNAVAILABLE');
      }

      const location = response.headers.get('location');
      if (!location || response.status < 300 || response.status >= 400) break;
      current = new URL(location, current);
    }

    throw new BadRequestException('MAP_COORDINATES_NOT_FOUND');
  }
}
