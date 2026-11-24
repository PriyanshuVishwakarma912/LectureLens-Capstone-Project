import 'dotenv/config';
import express from 'express';
import path from 'path';
import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from '@google/genai';
import {
  extractYouTubeVideoId,
  fetchYouTubeCaptions,
  fetchYouTubeMetadata,
  parseManualTranscript,
} from './server/youtube.ts';
import type {
  Flashcard,
  QuizQuestion,
  StudyNotes,
  TranscriptSegment,
  TranscriptSourceType,
  VideoMeta,
} from './src/types/lecture.ts';
import { BLUEPRINT_LIMITS, formatTimestamp } from './src/types/lecture.ts';

const PORT = Number(process.env.PORT) || 3000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function safeParseGeminiJson<T>(rawText: string | undefined, fallback: T): T {
  const trimmed = (rawText ?? '').trim();
  if (!trimmed) return fallback;
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    const startIdx =
      firstBrace === -1
        ? firstBracket
        : firstBracket === -1
          ? firstBrace
          : Math.min(firstBrace, firstBracket);
    if (startIdx !== -1) {
      const isArray = cleaned[startIdx] === '[';
      const endIdx = cleaned.lastIndexOf(isArray ? ']' : '}');
      if (endIdx > startIdx) {
        try {
          return JSON.parse(cleaned.slice(startIdx, endIdx + 1)) as T;
        } catch {
          return fallback;
        }
      }
    }
    return fallback;
  }
}

function downsampleEvenly<T>(items: T[], maxCount: number): T[] {
  if (items.length <= maxCount) return items;
  if (maxCount <= 0) return [];
  if (maxCount === 1) return [items[0]];
  const sampled: T[] = [];
  const step = (items.length - 1) / (maxCount - 1);
  for (let i = 0; i < maxCount; i++) {
    sampled.push(items[Math.round(i * step)]);
  }
  return sampled;
}

function formatTranscriptForPrompt(segments: TranscriptSegment[], maxChars = 160000): string {
  const lines = segments.map((s) => `[${formatTimestamp(s.startSec)} | ${s.startSec}s] ${s.text}`);
  const joined = lines.join('\n');
  if (joined.length <= maxChars) return joined;

  // Evenly sample segments across the full lecture timeline so long 10h+ lectures retain end-to-end coverage
  const avgLineLen = Math.max(40, Math.ceil(joined.length / Math.max(1, lines.length)));
  const targetCount = Math.max(10, Math.floor((maxChars - 120) / avgLineLen));
  const sampled = downsampleEvenly(lines, targetCount);
  const compact = sampled.join('\n');
  return compact.length > maxChars
    ? `${compact.slice(0, maxChars)}\n...[transcript condensed proportionally for context window]`
    : compact;
}

function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('500') ||
    msg.includes('INTERNAL')
  );
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    err.name === 'TimeoutError' ||
    err.name === 'AbortError' ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('timed out')
  );
}

function isTokenLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('exceeds the maximum number of tokens') ||
    msg.includes('input token count') ||
    msg.includes('1048576') ||
    (msg.includes('token') && msg.includes('limit'))
  );
}

function extractReadableErrorMessage(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string }; message?: string };
      if (parsed?.error?.message) return parsed.error.message;
      if (parsed?.message) return parsed.message;
    } catch {
      // Keep raw string if not valid JSON
    }
  }
  return trimmed;
}

async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  options?: { preferLite?: boolean }
) {
  const attempts: Array<{
    model: string;
    delayMs: number;
    timeoutMs: number;
    thinkingLevel?: ThinkingLevel;
  }> = options?.preferLite
    ? [
        { model: 'gemini-3.1-flash-lite', delayMs: 0, timeoutMs: 110000 },
        { model: 'gemini-4-hydrogen', delayMs: 500, timeoutMs: 90000, thinkingLevel: ThinkingLevel.LOW },
        { model: 'gemini-3.1-flash-lite', delayMs: 2500, timeoutMs: 110000 },
      ]
    : [
        { model: 'gemini-4-hydrogen', delayMs: 0, timeoutMs: 35000, thinkingLevel: ThinkingLevel.LOW },
        { model: 'gemini-3.1-flash-lite', delayMs: 500, timeoutMs: 40000 },
        { model: 'gemini-4-hydrogen', delayMs: 2000, timeoutMs: 40000, thinkingLevel: ThinkingLevel.LOW },
      ];

  let lastErr: unknown;
  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i];
    if (attempt.delayMs > 0) {
      const prevWasRateLimit =
        lastErr &&
        ((lastErr instanceof Error ? lastErr.message : String(lastErr)).includes('429') ||
          (lastErr instanceof Error ? lastErr.message : String(lastErr)).includes('RESOURCE_EXHAUSTED'));
      const waitMs = prevWasRateLimit ? Math.max(attempt.delayMs, 3500) : attempt.delayMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    try {
      const mergedConfig = {
        ...(params.config ?? {}),
        abortSignal: AbortSignal.timeout(attempt.timeoutMs),
        ...(attempt.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: attempt.thinkingLevel } }
          : {}),
      };
      return await ai.models.generateContent({
        model: attempt.model,
        ...params,
        config: mergedConfig,
      });
    } catch (err) {
      lastErr = err;
      if (!isTransientGeminiError(err) && !isTimeoutError(err)) {
        throw err;
      }
    }
  }
  throw lastErr;
}

function buildFriendlyGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const readable = extractReadableErrorMessage(raw);
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Gemini API access was denied. Please check your GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (isTokenLimitError(err)) {
    return {
      status: 413,
      message:
        'This lecture is too long to process in one pass (over 1M tokens). Try retrying or paste the lecture transcript below.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message: 'Gemini API rate limit reached. Please wait a moment and try again.',
    };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.includes('high demand')) {
    return {
      status: 503,
      message: 'Gemini is temporarily experiencing high demand. Please retry in a few seconds.',
    };
  }
  if (isTimeoutError(err)) {
    return {
      status: 504,
      message: 'Video processing took longer than expected. Please retry or paste the lecture transcript below.',
    };
  }
  return {
    status: 500,
    message: readable || 'Failed to generate study material with Gemini.',
  };
}

const VIDEO_WINDOW_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      startSec: { type: Type.INTEGER },
      text: { type: Type.STRING },
    },
    required: ['startSec', 'text'],
  },
};

const VIDEO_OVERVIEW_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    estimatedDurationSec: { type: Type.INTEGER },
    segments: VIDEO_WINDOW_SCHEMA,
  },
  required: ['estimatedDurationSec', 'segments'],
};

function sanitizeSegments(
  raw: Array<{ startSec?: number; text?: string }> | undefined
): TranscriptSegment[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
    .slice(0, BLUEPRINT_LIMITS.SEGMENTS_MAX)
    .map((s) => ({
      startSec: Math.max(0, Math.floor(Number(s.startSec) || 0)),
      text: String(s.text).trim().slice(0, 1000),
    }));
}

async function transcribeYouTubeOverview(
  ai: GoogleGenAI,
  youtubeUrl: string
): Promise<{ estimatedDurationSec: number; segments: TranscriptSegment[] }> {
  const res = await generateContentWithRetry(
    ai,
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: { fileUri: youtubeUrl },
              videoMetadata: { fps: 0.05 },
            },
            {
              text: 'Inspect this entire YouTube video from start to finish. First, report its total duration in integer seconds as estimatedDurationSec (for example, 600 for 10 minutes, 3600 for 1 hour, 16200 for 4.5 hours, 36000 for 10 hours). Second, produce a chronological topic-by-topic transcript / detailed spoken summary divided into 15 to 45 segments covering every topic from start to finish (or fewer segments if the video is under 3 minutes). Use integer startSec for each segment.',
            },
          ],
        },
      ],
      config: {
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
        responseMimeType: 'application/json',
        responseSchema: VIDEO_OVERVIEW_SCHEMA,
      },
    },
    { preferLite: true }
  );

  const parsed = safeParseGeminiJson<{
    estimatedDurationSec?: number;
    segments?: Array<{ startSec?: number; text?: string }>;
  }>(res.text, {});

  const segments = sanitizeSegments(parsed.segments);
  const maxSegSec = segments.length > 0 ? Math.max(...segments.map((s) => s.startSec)) : 0;
  const estimatedDurationSec = Math.max(
    Math.floor(Number(parsed.estimatedDurationSec) || 0),
    maxSegSec > 0 ? maxSegSec + 20 : 0
  );

  return { estimatedDurationSec, segments };
}

async function transcribeYouTubeWindow(
  ai: GoogleGenAI,
  youtubeUrl: string,
  window: { startSec: number; endSec: number }
): Promise<TranscriptSegment[]> {
  const clipDuration = window.endSec - window.startSec;
  const instruction = `Watch and listen ONLY to the clipped portion of this YouTube lecture from ${window.startSec}s to ${window.endSec}s and produce a thorough chronological transcript / detailed spoken coverage divided into 12 to 24 evenly spaced segments covering EVERY topic, subtopic, example, definition, and key point explained in this time window. If there is no spoken or visual content in this range (for example, if the video already ended), return an empty array []. Return a JSON array of objects with integer startSec (seconds elapsed from the start of this clip, 0 to ${clipDuration}) and text fields.`;

  const res = await generateContentWithRetry(
    ai,
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: { fileUri: youtubeUrl },
              videoMetadata: {
                fps: 0.05,
                startOffset: `${window.startSec}s`,
                endOffset: `${window.endSec}s`,
              },
            },
            { text: instruction },
          ],
        },
      ],
      config: {
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
        responseMimeType: 'application/json',
        responseSchema: VIDEO_WINDOW_SCHEMA,
      },
    },
    { preferLite: true }
  );

  const segments = sanitizeSegments(
    safeParseGeminiJson<Array<{ startSec?: number; text?: string }>>(res.text, [])
  );
  if (segments.length === 0) {
    return segments;
  }

  // Normalize timestamps if the model returned clip-relative (0..clipDuration) instead of absolute video seconds
  const maxReturnedSec = Math.max(...segments.map((s) => s.startSec));
  const needsOffsetShift = window.startSec > 0 && maxReturnedSec < window.startSec;
  return segments.map((s) => ({
    startSec: needsOffsetShift ? window.startSec + s.startSec : s.startSec,
    text: s.text,
  }));
}

async function transcribeLongYouTubeVideoInChunks(
  ai: GoogleGenAI,
  youtubeUrl: string,
  estimatedDurationSec?: number
): Promise<TranscriptSegment[]> {
  const MAX_CHUNKS = 20; // Supports up to 20 hours of lecture
  const CHUNK_SEC = estimatedDurationSec
    ? Math.min(3600, Math.max(2100, Math.ceil(estimatedDurationSec / 14)))
    : 2400; // 35-60 min chunks stay well below the 1M token window
  const targetChunkCount = estimatedDurationSec
    ? Math.min(MAX_CHUNKS, Math.max(2, Math.ceil(estimatedDurationSec / CHUNK_SEC)))
    : MAX_CHUNKS;

  const allSegments: TranscriptSegment[] = [];
  const BATCH_SIZE = 2;

  for (let base = 0; base < targetChunkCount; base += BATCH_SIZE) {
    if (base > 0) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    const batchIndices = Array.from({ length: BATCH_SIZE }, (_, k) => base + k).filter(
      (idx) => idx < targetChunkCount
    );
    const settled = await Promise.allSettled(
      batchIndices.map((i) =>
        transcribeYouTubeWindow(ai, youtubeUrl, {
          startSec: i * CHUNK_SEC,
          endSec: (i + 1) * CHUNK_SEC,
        })
      )
    );

    let reachedEnd = false;
    for (let j = 0; j < settled.length; j++) {
      const idx = batchIndices[j];
      const result = settled[j];
      if (result.status === 'fulfilled') {
        if (result.value.length === 0) {
          reachedEnd = true;
          break;
        }
        allSegments.push(...result.value);
      } else {
        const msg = (result.reason instanceof Error ? result.reason.message : String(result.reason)).toLowerCase();
        const isOffsetPastEnd =
          idx > 0 &&
          (msg.includes('invalid_argument') ||
            msg.includes('offset') ||
            msg.includes('duration') ||
            msg.includes('out of range') ||
            msg.includes('start_offset'));
        if (isOffsetPastEnd || (idx > 0 && allSegments.length > 0)) {
          reachedEnd = true;
          break;
        }
        throw result.reason;
      }
    }

    if (reachedEnd) {
      break;
    }
  }

  const sorted = allSegments.sort((a, b) => a.startSec - b.startSec);
  return downsampleEvenly(sorted, BLUEPRINT_LIMITS.SEGMENTS_MAX);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, geminiConfigured: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.post('/api/lectures/transcript', async (req, res) => {
    try {
      const { youtubeUrl } = (req.body ?? {}) as { youtubeUrl?: string };
      if (!youtubeUrl || typeof youtubeUrl !== 'string') {
        res.status(400).json({ error: 'Please paste a valid YouTube lecture link.' });
        return;
      }

      const videoId = extractYouTubeVideoId(youtubeUrl);
      if (!videoId) {
        res.status(400).json({
          error: 'Could not recognize a YouTube video ID. Try a full youtube.com/watch?v=... or youtu.be/... link.',
        });
        return;
      }

      const [videoMeta, scrapedSegments] = await Promise.all([
        fetchYouTubeMetadata(videoId),
        fetchYouTubeCaptions(videoId),
      ]);

      let transcriptSegments = scrapedSegments;
      if (transcriptSegments.length > 0) {
        const lastSec = Math.max(...transcriptSegments.map((s) => s.startSec));
        videoMeta.durationSec = Math.max(videoMeta.durationSec ?? 0, lastSec + 20);
      }

      let fallbackReason =
        'Automatic captions are unavailable or disabled for this video. Paste the lecture transcript below to continue.';

      if (transcriptSegments.length === 0 && process.env.GEMINI_API_KEY) {
        const ai = getGeminiClient();
        try {
          const overview = await transcribeYouTubeOverview(ai, videoMeta.youtubeUrl);
          transcriptSegments = overview.segments;
          if (overview.estimatedDurationSec > 2400) {
            // Long lecture (>40 min): extract detailed chunk-by-chunk coverage across the entire duration
            try {
              const chunked = await transcribeLongYouTubeVideoInChunks(
                ai,
                videoMeta.youtubeUrl,
                overview.estimatedDurationSec
              );
              if (chunked.length > overview.segments.length) {
                transcriptSegments = chunked;
              }
            } catch {
              // Keep full overview segments if chunk expansion hits rate limits
            }
          }

          if (transcriptSegments.length > 0) {
            const lastSec = Math.max(...transcriptSegments.map((s) => s.startSec));
            videoMeta.durationSec = Math.max(overview.estimatedDurationSec, lastSec + 20);
          }
        } catch (geminiErr) {
          if (isTokenLimitError(geminiErr) || isTimeoutError(geminiErr)) {
            try {
              transcriptSegments = await transcribeLongYouTubeVideoInChunks(ai, videoMeta.youtubeUrl);
              if (transcriptSegments.length > 0) {
                const lastSec = Math.max(...transcriptSegments.map((s) => s.startSec));
                videoMeta.durationSec = Math.max(videoMeta.durationSec ?? 0, lastSec + 60);
              }
            } catch (chunkErr) {
              const friendly = buildFriendlyGeminiError(chunkErr);
              fallbackReason = `${friendly.message} You can retry the link or paste the lecture transcript below.`;
            }
          } else {
            const friendly = buildFriendlyGeminiError(geminiErr);
            fallbackReason = `${friendly.message} You can retry the link or paste the lecture transcript below.`;
          }
        }
      }

      if (transcriptSegments.length === 0) {
        res.json({
          requiresManualTranscript: true,
          videoMeta,
          transcriptSegments: [],
          reason: fallbackReason,
        });
        return;
      }

      res.json({
        requiresManualTranscript: false,
        videoMeta,
        transcriptSegments,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to fetch YouTube transcript.';
      res.status(500).json({ error: msg });
    }
  });

  function clampInt(val: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Math.round(val)));
  }

  interface DurationPlan {
    durationSec: number;
    durationMinutes: number;
    summaryParagraphs: number;
    takeawaysTarget: number;
    sectionsTarget: number;
    glossaryTarget: number;
    flashcardsTarget: number;
    quizTarget: number;
    useChunkedMapReduce: boolean;
  }

  function computeDurationPlan(durationSec: number, transcriptChars: number): DurationPlan {
    const durationMinutes = Math.max(1, Math.round(durationSec / 60));
    const durationHours = durationSec / 3600;

    let summaryParagraphs: number;
    let takeawaysTarget: number;
    let sectionsTarget: number;
    let glossaryTarget: number;
    let flashcardsTarget: number;
    let quizTarget: number;

    if (durationMinutes <= 15) {
      summaryParagraphs = 2;
      takeawaysTarget = clampInt(5 + Math.round(durationMinutes / 4), 5, 8);
      sectionsTarget = clampInt(4 + Math.round(durationMinutes / 3), 4, 8);
      glossaryTarget = clampInt(6 + Math.round(durationMinutes / 3), 6, 12);
      flashcardsTarget = 10;
      quizTarget = 6;
    } else if (durationMinutes <= 60) {
      summaryParagraphs = 3;
      takeawaysTarget = clampInt(8 + Math.round((durationMinutes - 15) / 7), 8, 15);
      sectionsTarget = clampInt(8 + Math.round((durationMinutes - 15) / 5), 8, 16);
      glossaryTarget = clampInt(12 + Math.round((durationMinutes - 15) / 5), 12, 22);
      flashcardsTarget = clampInt(12 + Math.round((durationMinutes - 15) / 8), 12, 18);
      quizTarget = clampInt(8 + Math.round((durationMinutes - 15) / 10), 8, 12);
    } else {
      // Multi-hour scaling (e.g., 2h -> ~21 chapters; 5h -> ~44 chapters; 10h -> ~81 chapters)
      summaryParagraphs = clampInt(Math.round(durationHours * 0.55 + 2.5), 3, 7);
      takeawaysTarget = clampInt(Math.round(durationHours * 2.8 + 10), 12, 38);
      sectionsTarget = clampInt(Math.round(durationHours * 7.5 + 8), 16, 90);
      glossaryTarget = clampInt(Math.round(durationHours * 6.5 + 14), 18, 90);
      flashcardsTarget = clampInt(Math.round(durationHours * 3.5 + 14), 16, 55);
      quizTarget = clampInt(Math.round(durationHours * 1.8 + 9), 10, 28);
    }

    return {
      durationSec,
      durationMinutes,
      summaryParagraphs,
      takeawaysTarget,
      sectionsTarget,
      glossaryTarget,
      flashcardsTarget,
      quizTarget,
      useChunkedMapReduce: durationMinutes > 45 || transcriptChars > 26000,
    };
  }

  function partitionSegmentsIntoChunks(
    segments: TranscriptSegment[],
    targetChunkCount: number,
    maxCharsPerChunk = 28000
  ): TranscriptSegment[][] {
    const chunks: TranscriptSegment[][] = [];
    const perChunkTarget = Math.max(1, Math.ceil(segments.length / targetChunkCount));
    let current: TranscriptSegment[] = [];
    let currentChars = 0;

    for (const seg of segments) {
      const segLen = seg.text.length + 24;
      if (
        current.length > 0 &&
        (current.length >= perChunkTarget || currentChars + segLen > maxCharsPerChunk) &&
        chunks.length < targetChunkCount - 1
      ) {
        chunks.push(current);
        current = [seg];
        currentChars = segLen;
      } else {
        current.push(seg);
        currentChars += segLen;
      }
    }
    if (current.length > 0) {
      chunks.push(current);
    }
    return chunks;
  }

  app.post('/api/lectures/generate', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        videoMeta?: Partial<VideoMeta>;
        transcriptSegments?: TranscriptSegment[];
        manualTranscriptText?: string;
        sourceType?: TranscriptSourceType;
      };

      let segments: TranscriptSegment[] = Array.isArray(body.transcriptSegments)
        ? body.transcriptSegments.filter(
            (s) => s && typeof s.startSec === 'number' && typeof s.text === 'string' && s.text.trim().length > 0
          )
        : [];

      let sourceType: TranscriptSourceType =
        body.sourceType === 'manual_transcript' ? 'manual_transcript' : 'youtube_captions';

      if (typeof body.manualTranscriptText === 'string' && body.manualTranscriptText.trim().length > 0) {
        segments = parseManualTranscript(body.manualTranscriptText);
        sourceType = 'manual_transcript';
      }

      if (segments.length === 0) {
        res.status(400).json({ error: 'Transcript text is required to generate study material.' });
        return;
      }

      const videoId = (body.videoMeta?.videoId || 'manual').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'manual';
      const titleHint = (body.videoMeta?.title || 'Lecture Study Guide').slice(0, 300);
      const channelName = (body.videoMeta?.channelName || 'Independent Lecture').slice(0, 200);
      const youtubeUrl = (body.videoMeta?.youtubeUrl || `https://www.youtube.com/watch?v=${videoId}`).slice(0, 500);
      const thumbnailUrl = (body.videoMeta?.thumbnailUrl || '').slice(0, 500);

      const lastSegSec = Math.max(...segments.map((s) => Math.max(0, Math.floor(s.startSec))));
      const totalRawChars = segments.reduce((sum, s) => sum + s.text.length, 0);
      const effectiveDurationSec = Math.min(
        BLUEPRINT_LIMITS.DURATION_MAX,
        Math.max(
          Math.floor(Number(body.videoMeta?.durationSec) || 0),
          lastSegSec + 20,
          Math.round(totalRawChars / 14)
        )
      );
      const plan = computeDurationPlan(effectiveDurationSec, totalRawChars);

      const ai = getGeminiClient();

      let refinedTitle = titleHint;
      let executiveSummary = 'Summary unavailable.';
      let keyTakeaways: string[] = [];
      let sections: StudyNotes['sections'] = [];
      let glossary: StudyNotes['glossary'] = [];
      let flashcards: Flashcard[] = [];
      let quizQuestions: QuizQuestion[] = [];

      if (!plan.useChunkedMapReduce) {
        const formattedTranscript = formatTranscriptForPrompt(segments, 40000);
        const prompt = `You are a friendly, clear teacher creating complete, in-depth, easy-to-understand study notes from a lecture transcript (${plan.durationMinutes} minutes long).
Lecture title hint: "${titleHint}"
Speaker/Channel: "${channelName}"

Analyze EVERY part of the timestamped transcript below and generate duration-appropriate, thorough notes covering EVERY single topic, subtopic, concept, and example:
1. A clean, accurate lecture title (if the title hint is generic like "YouTube Lecture (...)", infer a clear descriptive title; otherwise keep or lightly polish it).
2. Detailed, Easy-to-Read Study Notes:
   - executiveSummary: ${plan.summaryParagraphs} clear, friendly paragraphs explaining the whole lecture in plain everyday English so anyone can grasp both the big picture and core flow.
   - keyTakeaways: ${plan.takeawaysTarget} clear bullet takeaways written in simple words covering all major ideas.
   - sections: ${plan.sectionsTarget} chronological topic sections covering EVERY topic in the transcript without skipping any point. Each section needs a clear heading, start timestamp in integer seconds (timestampSec matching the transcript), a detailed easy-to-follow summary (3 to 5 clear sentences explaining how and why the concept works), and 4 to 8 detailed bulletPoints covering all key points, steps, and examples.
   - glossary: ${plan.glossaryTarget} important terms or concepts from the lecture, each explained in plain, everyday language.
3. ${plan.flashcardsTarget} clear flashcards (front: simple question or prompt, back: short, easy-to-remember answer, timestampSec).
4. ${plan.quizTarget} straightforward multiple-choice quiz questions covering topics across the whole lecture (question in plain language, exactly 4 clear options, 0-based correctIndex, easy-to-understand explanation of why the answer is right, and timestampSec).

Strict rules:
- Use simple, everyday words and clear, beginner-friendly sentences throughout all notes, definitions, flashcards, and quiz explanations.
- Cover EVERY topic and concept mentioned in the transcript in depth—do not skip smaller sections.
- Whenever the speaker uses a technical term, explain it clearly in plain words.
- Every fact, definition, and timestamp MUST come strictly from the provided transcript.
- Use integer seconds for all timestampSec values.

TRANSCRIPT:
${formattedTranscript}`;

        const response = await generateContentWithRetry(ai, {
          contents: prompt,
          config: {
            systemInstruction:
              'Explain every concept in thorough detail using simple, plain, beginner-friendly language that any learner can understand easily. Cover every topic in the transcript without omitting points.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                refinedTitle: { type: Type.STRING },
                studyNotes: {
                  type: Type.OBJECT,
                  properties: {
                    executiveSummary: { type: Type.STRING },
                    keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
                    sections: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          heading: { type: Type.STRING },
                          timestampSec: { type: Type.INTEGER },
                          summary: { type: Type.STRING },
                          bulletPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                        },
                        required: ['heading', 'timestampSec', 'summary', 'bulletPoints'],
                      },
                    },
                    glossary: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          term: { type: Type.STRING },
                          definition: { type: Type.STRING },
                        },
                        required: ['term', 'definition'],
                      },
                    },
                  },
                  required: ['executiveSummary', 'keyTakeaways', 'sections', 'glossary'],
                },
                flashcards: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      front: { type: Type.STRING },
                      back: { type: Type.STRING },
                      timestampSec: { type: Type.INTEGER },
                    },
                    required: ['front', 'back', 'timestampSec'],
                  },
                },
                quizQuestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING },
                      options: { type: Type.ARRAY, items: { type: Type.STRING } },
                      correctIndex: { type: Type.INTEGER },
                      explanation: { type: Type.STRING },
                      timestampSec: { type: Type.INTEGER },
                    },
                    required: ['question', 'options', 'correctIndex', 'explanation', 'timestampSec'],
                  },
                },
              },
              required: ['refinedTitle', 'studyNotes', 'flashcards', 'quizQuestions'],
            },
          },
        });

        const parsed = safeParseGeminiJson<{
          refinedTitle?: string;
          studyNotes?: StudyNotes;
          flashcards?: Array<{ front: string; back: string; timestampSec: number }>;
          quizQuestions?: Array<{
            question: string;
            options: string[];
            correctIndex: number;
            explanation: string;
            timestampSec: number;
          }>;
        }>(response.text, {});

        refinedTitle = (parsed.refinedTitle || titleHint).slice(0, BLUEPRINT_LIMITS.TITLE_MAX);
        executiveSummary = (parsed.studyNotes?.executiveSummary || 'Summary unavailable.').slice(
          0,
          BLUEPRINT_LIMITS.SUMMARY_MAX
        );
        keyTakeaways = (parsed.studyNotes?.keyTakeaways || [])
          .map((t) => String(t).trim().slice(0, 600))
          .filter(Boolean)
          .slice(0, BLUEPRINT_LIMITS.TAKEAWAYS_MAX);
        sections = (parsed.studyNotes?.sections || [])
          .slice(0, BLUEPRINT_LIMITS.SECTIONS_MAX)
          .map((sec) => ({
            heading: String(sec.heading || 'Topic Section').trim().slice(0, 200) || 'Topic Section',
            timestampSec: Math.max(0, Math.floor(Number(sec.timestampSec) || 0)),
            summary: String(sec.summary || '').trim().slice(0, BLUEPRINT_LIMITS.SECTION_SUMMARY_MAX),
            bulletPoints: (sec.bulletPoints || [])
              .map((b) => String(b).trim().slice(0, 600))
              .filter(Boolean)
              .slice(0, BLUEPRINT_LIMITS.SECTION_BULLETS_MAX),
          }));
        glossary = (parsed.studyNotes?.glossary || [])
          .map((g) => ({
            term: String(g.term || '').trim().slice(0, 120),
            definition: String(g.definition || '').trim().slice(0, 600),
          }))
          .filter((g) => g.term.length > 0 && g.definition.length > 0)
          .slice(0, BLUEPRINT_LIMITS.GLOSSARY_MAX);
        flashcards = (parsed.flashcards || [])
          .slice(0, BLUEPRINT_LIMITS.FLASHCARDS_MAX)
          .map((c, idx) => ({
            id: `fc_${idx + 1}`,
            front: String(c.front || '').slice(0, 500),
            back: String(c.back || '').slice(0, 1000),
            timestampSec: Math.max(0, Math.floor(Number(c.timestampSec) || 0)),
            status: 'new',
          }));
        quizQuestions = (parsed.quizQuestions || [])
          .slice(0, BLUEPRINT_LIMITS.QUIZ_MAX)
          .map((q, idx) => {
            const opts = (q.options || []).slice(0, 4).map((o) => String(o).slice(0, 300));
            while (opts.length < 4) opts.push('None of the above');
            const safeIndex = Math.min(opts.length - 1, Math.max(0, Math.floor(Number(q.correctIndex) || 0)));
            return {
              id: `q_${idx + 1}`,
              question: String(q.question || '').slice(0, 500),
              options: opts,
              correctIndex: safeIndex,
              explanation: String(q.explanation || '').slice(0, 800),
              timestampSec: Math.max(0, Math.floor(Number(q.timestampSec) || 0)),
            };
          });
      } else {
        // Multi-hour / large-transcript Map-Reduce Synthesis:
        // Preserves 100% of topics across 1h to 10h+ lectures and scales note length proportionally.
        const targetChunkCount = clampInt(
          Math.max(Math.ceil(plan.durationMinutes / 40), Math.ceil(totalRawChars / 22000)),
          2,
          14
        );
        const chunks = partitionSegmentsIntoChunks(segments, targetChunkCount);
        const sectionsPerChunk = clampInt(Math.round(plan.sectionsTarget / chunks.length), 4, 9);
        const glossaryPerChunk = clampInt(Math.round(plan.glossaryTarget / chunks.length), 4, 8);

        interface ChunkMapResult {
          sections: StudyNotes['sections'];
          keyPoints: string[];
          glossary: StudyNotes['glossary'];
        }

        const chunkResults: ChunkMapResult[] = [];
        const MAP_BATCH = 4;
        let lastChunkErr: unknown;

        for (let base = 0; base < chunks.length; base += MAP_BATCH) {
          const batch = chunks.slice(base, base + MAP_BATCH);
          const settled = await Promise.allSettled(
            batch.map(async (chunkSegs, offset) => {
              const partNum = base + offset + 1;
              const startLabel = formatTimestamp(chunkSegs[0].startSec);
              const endLabel = formatTimestamp(chunkSegs[chunkSegs.length - 1].startSec);
              const chunkText = formatTranscriptForPrompt(chunkSegs, 30000);

              const mapPrompt = `You are creating detailed, easy-to-understand study notes for Part ${partNum} of ${chunks.length} (${startLabel} to ${endLabel}) of a ${plan.durationMinutes}-minute lecture: "${titleHint}".

Analyze EVERY single point, topic, concept, example, and explanation in this segment and generate:
- sections: ${sectionsPerChunk} to ${sectionsPerChunk + 2} chronological topic sections covering EVERY topic in this segment without skipping anything. Each section must have:
  * heading: clear descriptive topic title
  * timestampSec: integer start seconds matching the transcript
  * summary: 3 to 5 simple, thorough sentences explaining what the topic means, why it matters, and how it works
  * bulletPoints: 4 to 8 detailed bullet points covering all important details, steps, rules, and examples in plain words
- keyPoints: 2 to 4 crisp takeaways from this part in everyday English
- glossary: ${glossaryPerChunk} important terms or concepts introduced in this part, explained in simple, beginner-friendly language

Strict rules:
- Use simple, everyday words and short, clear sentences. Explain every technical term plainly.
- Every fact and timestamp must come strictly from this transcript excerpt.

TRANSCRIPT EXCERPT (${startLabel} - ${endLabel}):
${chunkText}`;

              const mapRes = await generateContentWithRetry(ai, {
                contents: mapPrompt,
                config: {
                  systemInstruction:
                    'Explain every concept in thorough detail using simple, plain, beginner-friendly language. Cover every topic in the segment accurately.',
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      sections: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            heading: { type: Type.STRING },
                            timestampSec: { type: Type.INTEGER },
                            summary: { type: Type.STRING },
                            bulletPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                          },
                          required: ['heading', 'timestampSec', 'summary', 'bulletPoints'],
                        },
                      },
                      keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                      glossary: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            term: { type: Type.STRING },
                            definition: { type: Type.STRING },
                          },
                          required: ['term', 'definition'],
                        },
                      },
                    },
                    required: ['sections', 'keyPoints', 'glossary'],
                  },
                },
              });

              const parsedMap = safeParseGeminiJson<{
                sections?: StudyNotes['sections'];
                keyPoints?: string[];
                glossary?: StudyNotes['glossary'];
              }>(mapRes.text, {});

              return {
                sections: (parsedMap.sections || []).map((sec) => ({
                  heading: String(sec.heading || 'Topic Section').trim().slice(0, 200) || 'Topic Section',
                  timestampSec: Math.max(0, Math.floor(Number(sec.timestampSec) || 0)),
                  summary: String(sec.summary || '').trim().slice(0, BLUEPRINT_LIMITS.SECTION_SUMMARY_MAX),
                  bulletPoints: (sec.bulletPoints || [])
                    .map((b) => String(b).trim().slice(0, 600))
                    .filter(Boolean)
                    .slice(0, BLUEPRINT_LIMITS.SECTION_BULLETS_MAX),
                })),
                keyPoints: (parsedMap.keyPoints || [])
                  .map((k) => String(k).trim().slice(0, 600))
                  .filter(Boolean),
                glossary: (parsedMap.glossary || [])
                  .map((g) => ({
                    term: String(g.term || '').trim().slice(0, 120),
                    definition: String(g.definition || '').trim().slice(0, 600),
                  }))
                  .filter((g) => g.term.length > 0 && g.definition.length > 0),
              } satisfies ChunkMapResult;
            })
          );

          for (const resItem of settled) {
            if (resItem.status === 'fulfilled') {
              chunkResults.push(resItem.value);
            } else {
              lastChunkErr = resItem.reason;
            }
          }
        }

        if (chunkResults.length === 0) {
          throw lastChunkErr ?? new Error('Failed to analyze lecture chunks.');
        }

        const sortedSections = chunkResults
          .flatMap((c) => c.sections)
          .sort((a, b) => a.timestampSec - b.timestampSec);
        sections = downsampleEvenly(sortedSections, BLUEPRINT_LIMITS.SECTIONS_MAX);

        const seenTerms = new Set<string>();
        const dedupedGlossary: StudyNotes['glossary'] = [];
        for (const item of chunkResults.flatMap((c) => c.glossary)) {
          const key = item.term.trim().toLowerCase();
          if (!key || seenTerms.has(key)) continue;
          seenTerms.add(key);
          dedupedGlossary.push(item);
        }
        glossary = downsampleEvenly(dedupedGlossary, BLUEPRINT_LIMITS.GLOSSARY_MAX);

        const allKeyPoints = chunkResults.flatMap((c) => c.keyPoints);
        const outlineForReduce = sections
          .map(
            (sec, idx) =>
              `${idx + 1}. [${formatTimestamp(sec.timestampSec)} | ${sec.timestampSec}s] ${sec.heading}: ${sec.summary}`
          )
          .join('\n')
          .slice(0, 48000);

        const reducePrompt = `You are creating the complete curriculum overview, flashcards, and quiz for a ${plan.durationMinutes}-minute lecture: "${titleHint}" by "${channelName}".

Below is the complete chronological outline of all ${sections.length} chapters extracted from the full lecture, plus key takeaways from each part.

Generate:
1. refinedTitle: clean, accurate descriptive title.
2. executiveSummary: ${plan.summaryParagraphs} well-structured, friendly paragraphs in plain everyday English giving a thorough big-picture walkthrough of the entire lecture from start to finish.
3. keyTakeaways: Generate ${plan.takeawaysTarget} clear bullet takeaways in simple words summarizing the core lessons across all parts of the lecture.
4. flashcards: You MUST generate all ${plan.flashcardsTarget} clear flashcards distributed across early, middle, and late chapters (front: simple question, back: easy-to-remember answer, timestampSec matching the chapter).
5. quizQuestions: You MUST generate all ${plan.quizTarget} multiple-choice quiz questions distributed across the entire lecture (plain-English question, 4 clear options, 0-based correctIndex, simple explanation, timestampSec).

CHRONOLOGICAL OUTLINE:
${outlineForReduce}

PART HIGHLIGHTS:
${allKeyPoints.slice(0, 60).map((p) => `- ${p}`).join('\n')}`;

        const reduceRes = await generateContentWithRetry(ai, {
          contents: reducePrompt,
          config: {
            systemInstruction:
              'Write in simple, plain, beginner-friendly English so any learner can understand easily. Distribute flashcards and quiz questions across the entire lecture duration.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                refinedTitle: { type: Type.STRING },
                executiveSummary: { type: Type.STRING },
                keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
                flashcards: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      front: { type: Type.STRING },
                      back: { type: Type.STRING },
                      timestampSec: { type: Type.INTEGER },
                    },
                    required: ['front', 'back', 'timestampSec'],
                  },
                },
                quizQuestions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING },
                      options: { type: Type.ARRAY, items: { type: Type.STRING } },
                      correctIndex: { type: Type.INTEGER },
                      explanation: { type: Type.STRING },
                      timestampSec: { type: Type.INTEGER },
                    },
                    required: ['question', 'options', 'correctIndex', 'explanation', 'timestampSec'],
                  },
                },
              },
              required: ['refinedTitle', 'executiveSummary', 'keyTakeaways', 'flashcards', 'quizQuestions'],
            },
          },
        });

        const parsedReduce = safeParseGeminiJson<{
          refinedTitle?: string;
          executiveSummary?: string;
          keyTakeaways?: string[];
          flashcards?: Array<{ front: string; back: string; timestampSec: number }>;
          quizQuestions?: Array<{
            question: string;
            options: string[];
            correctIndex: number;
            explanation: string;
            timestampSec: number;
          }>;
        }>(reduceRes.text, {});

        refinedTitle = (parsedReduce.refinedTitle || titleHint).slice(0, BLUEPRINT_LIMITS.TITLE_MAX);
        executiveSummary = (parsedReduce.executiveSummary || 'Summary unavailable.').slice(
          0,
          BLUEPRINT_LIMITS.SUMMARY_MAX
        );
        keyTakeaways = (
          parsedReduce.keyTakeaways?.length ? parsedReduce.keyTakeaways : allKeyPoints
        )
          .map((t) => String(t).trim().slice(0, 600))
          .filter(Boolean)
          .slice(0, BLUEPRINT_LIMITS.TAKEAWAYS_MAX);
        flashcards = (parsedReduce.flashcards || [])
          .slice(0, BLUEPRINT_LIMITS.FLASHCARDS_MAX)
          .map((c, idx) => ({
            id: `fc_${idx + 1}`,
            front: String(c.front || '').slice(0, 500),
            back: String(c.back || '').slice(0, 1000),
            timestampSec: Math.max(0, Math.floor(Number(c.timestampSec) || 0)),
            status: 'new',
          }));
        quizQuestions = (parsedReduce.quizQuestions || [])
          .slice(0, BLUEPRINT_LIMITS.QUIZ_MAX)
          .map((q, idx) => {
            const opts = (q.options || []).slice(0, 4).map((o) => String(o).slice(0, 300));
            while (opts.length < 4) opts.push('None of the above');
            const safeIndex = Math.min(opts.length - 1, Math.max(0, Math.floor(Number(q.correctIndex) || 0)));
            return {
              id: `q_${idx + 1}`,
              question: String(q.question || '').slice(0, 500),
              options: opts,
              correctIndex: safeIndex,
              explanation: String(q.explanation || '').slice(0, 800),
              timestampSec: Math.max(0, Math.floor(Number(q.timestampSec) || 0)),
            };
          });
      }

      const boundedSegments = downsampleEvenly(segments, BLUEPRINT_LIMITS.SEGMENTS_MAX).map((s) => ({
        startSec: Math.max(0, Math.floor(s.startSec)),
        text: s.text.trim().slice(0, 1000),
      }));

      const studyNotes: StudyNotes = {
        executiveSummary,
        keyTakeaways,
        sections,
        glossary,
      };

      if (flashcards.length === 0 || quizQuestions.length === 0 || sections.length === 0) {
        res.status(502).json({
          error: 'The AI response did not include complete study sections, flashcards, or quiz questions. Please retry.',
        });
        return;
      }

      res.json({
        videoMeta: {
          videoId,
          youtubeUrl,
          title: refinedTitle,
          channelName,
          thumbnailUrl,
          durationSec: effectiveDurationSec,
        },
        sourceType,
        durationSec: effectiveDurationSec,
        transcriptSegments: boundedSegments,
        studyNotes,
        flashcards,
        quizQuestions,
      });
    } catch (err) {
      const { status, message } = buildFriendlyGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/lectures/chat', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        lectureTitle?: string;
        transcriptSegments?: TranscriptSegment[];
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        question?: string;
      };

      const question = (body.question || '').trim();
      if (!question) {
        res.status(400).json({ error: 'Please enter a question about the lecture.' });
        return;
      }

      const segments = Array.isArray(body.transcriptSegments) ? body.transcriptSegments : [];
      if (segments.length === 0) {
        res.status(400).json({ error: 'Lecture transcript context is missing.' });
        return;
      }

      const ai = getGeminiClient();
      const transcriptContext = formatTranscriptForPrompt(segments);
      const recentHistory = (body.history || [])
        .slice(-8)
        .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
        .join('\n\n');

      const prompt = `Lecture Title: "${body.lectureTitle || 'Lecture'}"

TIMESTAMPED TRANSCRIPT:
${transcriptContext}

${recentHistory ? `RECENT CONVERSATION:\n${recentHistory}\n\n` : ''}STUDENT QUESTION:
${question}

Answer in simple, clear, everyday language so the student understands right away. Use short sentences and explain any technical words plainly, based strictly on the lecture transcript above. If the lecture does not cover the point asked, say so clearly and relate back to what the speaker did explain. Return integer seconds in timestampRefs for the most relevant moments in the transcript.`;

      const response = await generateContentWithRetry(ai, {
        contents: prompt,
        config: {
          systemInstruction:
            'You are LectureLens Tutor, a friendly, easy-to-understand study helper grounded strictly in the provided lecture transcript. Explain ideas in plain, simple words and cite relevant moments accurately.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answer: { type: Type.STRING },
              timestampRefs: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
              },
            },
            required: ['answer', 'timestampRefs'],
          },
        },
      });

      const parsed = safeParseGeminiJson<{
        answer?: string;
        timestampRefs?: number[];
      }>(response.text, {});

      const answer = String(parsed.answer || 'I could not find an answer in the transcript.').slice(
        0,
        BLUEPRINT_LIMITS.CHAT_CONTENT_MAX
      );
      const timestampRefs = Array.from(
        new Set(
          (parsed.timestampRefs || [])
            .map((t) => Math.max(0, Math.floor(Number(t))))
            .filter((t) => Number.isFinite(t))
        )
      ).slice(0, BLUEPRINT_LIMITS.CHAT_REFS_MAX);

      res.json({ answer, timestampRefs });
    } catch (err) {
      const { status, message } = buildFriendlyGeminiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`LectureLens server running on http://0.0.0.0:${PORT}`);
  });
  httpServer.requestTimeout = 600000;
}

startServer().catch((err) => {
  console.error('Failed to start LectureLens server:', err);
  process.exit(1);
});
