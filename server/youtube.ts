import type { TranscriptSegment, VideoMeta } from '../src/types/lecture.ts';

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  let normalized = trimmed;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();

    if (host === 'youtu.be') {
      const candidate = parsed.pathname.split('/').filter(Boolean)[0] ?? '';
      return YOUTUBE_ID_REGEX.test(candidate) ? candidate : null;
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com' ||
      host === 'youtube-nocookie.com'
    ) {
      const vParam = parsed.searchParams.get('v');
      if (vParam && YOUTUBE_ID_REGEX.test(vParam)) {
        return vParam;
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
        return YOUTUBE_ID_REGEX.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_match, dec) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchYouTubeMetadata(videoId: string): Promise<VideoMeta> {
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const fallback: VideoMeta = {
    videoId,
    youtubeUrl: canonicalUrl,
    title: `YouTube Lecture (${videoId})`,
    channelName: 'YouTube Creator',
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const res = await fetch(oembedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LectureLens/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      videoId,
      youtubeUrl: canonicalUrl,
      title: (data.title || fallback.title).slice(0, 300),
      channelName: (data.author_name || fallback.channelName).slice(0, 200),
      thumbnailUrl: (data.thumbnail_url || fallback.thumbnailUrl).slice(0, 500),
    };
  } catch {
    return fallback;
  }
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

function pickBestTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (!tracks.length) return null;
  const englishManual = tracks.find(
    (t) => t.languageCode?.toLowerCase().startsWith('en') && t.kind !== 'asr' && t.baseUrl
  );
  if (englishManual) return englishManual;

  const englishAny = tracks.find(
    (t) => t.languageCode?.toLowerCase().startsWith('en') && t.baseUrl
  );
  if (englishAny) return englishAny;

  const manualAny = tracks.find((t) => t.kind !== 'asr' && t.baseUrl);
  if (manualAny) return manualAny;

  return tracks.find((t) => Boolean(t.baseUrl)) ?? null;
}

async function fetchTrackSegments(baseUrl: string): Promise<TranscriptSegment[]> {
  // Try JSON3 format first for cleaner structured timings
  const jsonUrl = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`;
  try {
    const res = await fetch(jsonUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LectureLens/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const rawText = await res.text();
      if (contentType.includes('json') || rawText.trim().startsWith('{')) {
        const parsed = JSON.parse(rawText) as {
          events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }>;
        };
        const rawSegments: TranscriptSegment[] = [];
        for (const ev of parsed.events ?? []) {
          if (!ev.segs?.length) continue;
          const text = decodeHtmlEntities(ev.segs.map((s) => s.utf8 ?? '').join(''));
          if (!text) continue;
          rawSegments.push({
            startSec: Math.max(0, Math.floor((ev.tStartMs ?? 0) / 1000)),
            text,
          });
        }
        if (rawSegments.length > 0) {
          return mergeSegmentsForStudy(rawSegments);
        }
      } else {
        const xmlSegments = parseXmlCaptions(rawText);
        if (xmlSegments.length > 0) {
          return mergeSegmentsForStudy(xmlSegments);
        }
      }
    }
  } catch {
    // Fall through to XML attempt
  }

  try {
    const res = await fetch(baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LectureLens/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return mergeSegmentsForStudy(parseXmlCaptions(xml));
  } catch {
    return [];
  }
}

function parseXmlCaptions(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const regex = /<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    const startSec = Math.max(0, Math.floor(Number(match[1]) || 0));
    const text = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' '));
    if (text) {
      segments.push({ startSec, text });
    }
  }
  return segments;
}

export function mergeSegmentsForStudy(
  raw: TranscriptSegment[],
  targetWindowSec = 22,
  maxSegments = 450
): TranscriptSegment[] {
  if (raw.length === 0) return [];
  const grouped: TranscriptSegment[] = [];
  let bucketStart = raw[0].startSec;
  let bucketTexts: string[] = [];

  for (const seg of raw) {
    const clean = seg.text.replace(/\s+/g, ' ').trim();
    if (!clean) continue;

    if (bucketTexts.length > 0 && (seg.startSec - bucketStart >= targetWindowSec || bucketTexts.join(' ').length > 340)) {
      grouped.push({
        startSec: bucketStart,
        text: bucketTexts.join(' ').slice(0, 600),
      });
      bucketStart = seg.startSec;
      bucketTexts = [clean];
    } else {
      if (bucketTexts.length === 0) {
        bucketStart = seg.startSec;
      }
      bucketTexts.push(clean);
    }
  }

  if (bucketTexts.length > 0) {
    grouped.push({
      startSec: bucketStart,
      text: bucketTexts.join(' ').slice(0, 600),
    });
  }

  // If lecture is extremely long (>2.5h), downsample gently so Firestore & prompt limits stay safe
  if (grouped.length <= maxSegments) return grouped;
  const stride = Math.ceil(grouped.length / maxSegments);
  const condensed: TranscriptSegment[] = [];
  for (let i = 0; i < grouped.length; i += stride) {
    const slice = grouped.slice(i, i + stride);
    condensed.push({
      startSec: slice[0].startSec,
      text: slice.map((s) => s.text).join(' ').slice(0, 900),
    });
  }
  return condensed.slice(0, maxSegments);
}

export async function fetchYouTubeCaptions(videoId: string): Promise<TranscriptSegment[]> {
  const tryInnertube = async (): Promise<TranscriptSegment[]> => {
    const innertubeRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '19.09.37',
            androidSdkVersion: 30,
            hl: 'en',
            gl: 'US',
          },
        },
        videoId,
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (!innertubeRes.ok) return [];
    const json = (await innertubeRes.json()) as {
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
    };
    const tracks = json.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const best = pickBestTrack(tracks);
    if (!best?.baseUrl) return [];
    return fetchTrackSegments(best.baseUrl);
  };

  const extractBalancedJsonArray = (source: string, keyMarker: string): string | null => {
    const markerIdx = source.indexOf(keyMarker);
    if (markerIdx === -1) return null;
    const startIdx = source.indexOf('[', markerIdx + keyMarker.length);
    if (startIdx === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIdx; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth === 0) {
          return source.slice(startIdx, i + 1);
        }
      }
    }
    return null;
  };

  const tryWatchHtml = async (): Promise<TranscriptSegment[]> => {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(4000),
    });

    if (!pageRes.ok) return [];
    const html = await pageRes.text();
    const rawArray = extractBalancedJsonArray(html, '"captionTracks":');
    if (!rawArray) return [];
    const tracks = JSON.parse(rawArray) as CaptionTrack[];
    const best = pickBestTrack(tracks);
    if (!best?.baseUrl) return [];
    return fetchTrackSegments(best.baseUrl);
  };

  try {
    const results = await Promise.allSettled([tryInnertube(), tryWatchHtml()]);
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        return r.value;
      }
    }
  } catch {
    // Captions unavailable
  }

  return [];
}

export function parseManualTranscript(rawText: string): TranscriptSegment[] {
  const cleaned = rawText.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
  const timestampLineRegex = /^[\[(]?(\d{1,2}:)?(\d{1,2}):(\d{2})[\])]?\s*[-–:]?\s*(.*)$/;

  const parsed: TranscriptSegment[] = [];
  let currentSec = 0;

  for (const line of lines) {
    const match = line.match(timestampLineRegex);
    if (match) {
      const hrs = match[1] ? Number(match[1].replace(':', '')) : 0;
      const mins = Number(match[2]);
      const secs = Number(match[3]);
      currentSec = hrs * 3600 + mins * 60 + secs;
      const body = match[4].trim();
      if (body) {
        parsed.push({ startSec: currentSec, text: body });
      }
    } else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(line)) {
      const parts = line.split(':').map(Number);
      currentSec =
        parts.length === 3
          ? parts[0] * 3600 + parts[1] * 60 + parts[2]
          : parts[0] * 60 + parts[1];
    } else {
      // Synthesize ~20s increments for untimestamped prose blocks
      const approxSec = parsed.length === 0 ? 0 : currentSec;
      parsed.push({ startSec: approxSec, text: line });
      currentSec += Math.max(8, Math.round(line.split(/\s+/).length / 2.5));
    }
  }

  if (parsed.length === 0) {
    return [{ startSec: 0, text: cleaned.slice(0, 600) }];
  }

  return mergeSegmentsForStudy(parsed, 22, 800);
}
