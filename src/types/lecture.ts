export type TranscriptSourceType = 'youtube_captions' | 'manual_transcript';

export interface TranscriptSegment {
  startSec: number;
  text: string;
}

export interface VideoMeta {
  videoId: string;
  youtubeUrl: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  durationSec?: number;
}

export interface StudySection {
  heading: string;
  timestampSec: number;
  summary: string;
  bulletPoints: string[];
}

export interface GlossaryItem {
  term: string;
  definition: string;
}

export interface StudyNotes {
  executiveSummary: string;
  keyTakeaways: string[];
  sections: StudySection[];
  glossary: GlossaryItem[];
}

export type FlashcardStatus = 'new' | 'review' | 'mastered';

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  timestampSec: number;
  status: FlashcardStatus;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  timestampSec: number;
}

export interface QuizProgress {
  selectedAnswers: number[];
  lastScore: number;
  bestScore: number;
  totalQuestions: number;
  attemptCount: number;
  lastAttemptAt?: unknown;
}

export interface LectureStudyKit {
  id: string;
  ownerId: string;
  videoId: string;
  youtubeUrl: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  sourceType: TranscriptSourceType;
  durationSec?: number;
  transcriptSegments: TranscriptSegment[];
  studyNotes: StudyNotes;
  flashcards: Flashcard[];
  quizQuestions: QuizQuestion[];
  quizProgress: QuizProgress;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LectureChatMessage {
  id: string;
  ownerId: string;
  lectureId: string;
  role: 'user' | 'assistant';
  content: string;
  timestampRefs: number[];
  createdAt?: unknown;
}

export const BLUEPRINT_LIMITS = {
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  ID_MAX: 128,
  VIDEO_ID_MAX: 32,
  URL_MAX: 500,
  TITLE_MAX: 300,
  CHANNEL_MAX: 200,
  DURATION_MAX: 172800,
  SUMMARY_MAX: 12000,
  TAKEAWAYS_MAX: 40,
  SECTIONS_MAX: 100,
  SECTION_SUMMARY_MAX: 2000,
  SECTION_BULLETS_MAX: 12,
  GLOSSARY_MAX: 100,
  SEGMENTS_MAX: 800,
  FLASHCARDS_MAX: 60,
  QUIZ_MAX: 30,
  CHAT_CONTENT_MAX: 8000,
  CHAT_REFS_MAX: 12,
} as const;

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationLabel(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const safe = Math.floor(seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
  return `${secs}s`;
}
