import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  FileText,
  Link2,
  Loader2,
  Youtube,
} from 'lucide-react';
import type { VideoMeta } from '../types/lecture';

export type IngestionStage =
  | 'idle'
  | 'fetching_transcript'
  | 'needs_manual_transcript'
  | 'generating_study_kit';

interface LectureIntakeHeroProps {
  stage: IngestionStage;
  youtubeUrl: string;
  onChangeUrl: (val: string) => void;
  onSubmitUrl: (url: string) => void;
  manualTranscriptText: string;
  onChangeManualTranscript: (val: string) => void;
  onSubmitManualTranscript: () => void;
  onCancelFallback: () => void;
  pendingVideoMeta: VideoMeta | null;
  fallbackReason: string | null;
  errorMessage: string | null;
  onOpenManualMode: () => void;
}

const SAMPLE_LECTURES = [
  {
    label: 'MIT 6.S191: Intro to Deep Learning',
    url: 'https://www.youtube.com/watch?v=ErnWwxJhatM',
  },
  {
    label: '3Blue1Brown: But what is a neural network?',
    url: 'https://www.youtube.com/watch?v=aircAruvnKk',
  },
  {
    label: 'Stanford CS229: Machine Learning Overview',
    url: 'https://www.youtube.com/watch?v=jGwO_UgTS7I',
  },
];

export function LectureIntakeHero({
  stage,
  youtubeUrl,
  onChangeUrl,
  onSubmitUrl,
  manualTranscriptText,
  onChangeManualTranscript,
  onSubmitManualTranscript,
  onCancelFallback,
  pendingVideoMeta,
  fallbackReason,
  errorMessage,
  onOpenManualMode,
}: LectureIntakeHeroProps) {
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  const isBusy = stage === 'fetching_transcript' || stage === 'generating_study_kit';

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isBusy) {
      onSubmitUrl(youtubeUrl);
    }
  };

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isBusy) {
      onSubmitManualTranscript();
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10 lg:py-14">
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        {/* Left: Primary Study Intake */}
        <div className="lg:col-span-7 flex flex-col justify-center">
          <p className="text-xs font-medium text-sky-700 tracking-wide mb-3">
            Academic Video Synthesis · Notes, Quiz, Flashcards &amp; Q&amp;A
          </p>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-bold text-slate-900 leading-[1.14] tracking-tight mb-4">
            Turn any YouTube lecture into a complete study kit.
          </h1>
          <p className="text-base text-slate-600 leading-relaxed max-w-[60ch] mb-7">
            Paste a lecture link to extract the transcript and build structured timestamped
            notes, an auto-graded quiz, spaced-practice flashcards, and a grounded Q&amp;A
            tutor.
          </p>

          {stage === 'needs_manual_transcript' ? (
            <form
              onSubmit={handleManualSubmit}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4"
            >
              {pendingVideoMeta && (
                <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
                  {pendingVideoMeta.thumbnailUrl && !thumbFailed ? (
                    <img
                      src={pendingVideoMeta.thumbnailUrl}
                      alt={pendingVideoMeta.title}
                      referrerPolicy="no-referrer"
                      onError={() => setThumbFailed(true)}
                      className="w-24 h-14 object-cover rounded-lg border border-slate-200 shrink-0"
                    />
                  ) : (
                    <div className="w-24 h-14 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                      <Youtube className="w-5 h-5 text-slate-400" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="font-sans text-sm font-semibold text-slate-900 truncate">
                      {pendingVideoMeta.title}
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {pendingVideoMeta.channelName} · Manual Transcript Mode
                    </p>
                  </div>
                </div>
              )}

              {fallbackReason && (
                <div className="flex items-start gap-2.5 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                  <p>{fallbackReason}</p>
                </div>
              )}

              <div>
                <label
                  htmlFor="manual-transcript"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Lecture Transcript Text
                </label>
                <textarea
                  id="manual-transcript"
                  rows={7}
                  value={manualTranscriptText}
                  onChange={(e) => onChangeManualTranscript(e.target.value)}
                  placeholder="Paste the YouTube transcript here (optional [MM:SS] timestamps are preserved automatically)..."
                  className="w-full rounded-xl border border-slate-300 bg-slate-50/50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600 focus:border-sky-600"
                />
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                  <p>{errorMessage}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onCancelFallback}
                    className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
                  >
                    Try Another Link
                  </button>
                  {pendingVideoMeta && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => onSubmitUrl(pendingVideoMeta.youtubeUrl)}
                      className="px-3 py-2 text-sm font-medium text-sky-700 hover:text-sky-800 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
                    >
                      Retry Auto-Extract
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={isBusy || manualTranscriptText.trim().length < 30}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-xl hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
                >
                  Generate Study Kit
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <form
                onSubmit={handleFormSubmit}
                className="bg-white border border-slate-200 rounded-2xl p-2.5 shadow-sm flex flex-col sm:flex-row gap-2.5"
              >
                <div className="relative flex-1 flex items-center">
                  <Link2 className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
                  <input
                    type="url"
                    aria-label="YouTube lecture URL"
                    value={youtubeUrl}
                    onChange={(e) => onChangeUrl(e.target.value)}
                    disabled={isBusy}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full pl-10 pr-4 py-3 text-sm text-slate-900 bg-transparent rounded-xl placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isBusy || !youtubeUrl.trim()}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-sky-600 rounded-xl hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing
                    </>
                  ) : (
                    <>
                      Generate Study Kit
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {isBusy && (
                <div
                  aria-live="polite"
                  className="bg-white border border-slate-200 rounded-xl px-4 py-3.5 flex items-center gap-3 text-sm text-slate-700"
                >
                  <Loader2 className="w-4 h-4 text-sky-600 animate-spin shrink-0" />
                  <div>
                    <span className="font-medium text-slate-900">
                      {stage === 'fetching_transcript'
                        ? 'Inspecting full video duration & extracting all topics...'
                        : 'Writing in-depth study notes, quiz & flashcards scaled to video length...'}
                    </span>
                    <span className="text-slate-500 ml-2 text-xs">
                      Multi-hour lectures may take 30–90 seconds for full coverage
                    </span>
                  </div>
                </div>
              )}

              {errorMessage && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                  <p>{errorMessage}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">Try a lecture:</span>
                  {SAMPLE_LECTURES.map((sample) => (
                    <button
                      key={sample.url}
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        onChangeUrl(sample.url);
                        onSubmitUrl(sample.url);
                      }}
                      className="text-sky-700 hover:text-sky-800 hover:underline underline-offset-4 transition-colors disabled:opacity-50 text-left"
                    >
                      {sample.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onOpenManualMode}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Paste transcript text instead
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Editorial Visual */}
        <div className="lg:col-span-5 flex">
          <div className="w-full bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col">
            {!heroImgFailed ? (
              <img
                src="/src/assets/images/lecture_studio_illustration_1795358795698.jpg"
                alt="Editorial study notebook, prism, and structured flashcards on a daylight desk"
                referrerPolicy="no-referrer"
                onError={() => setHeroImgFailed(true)}
                className="w-full h-56 lg:h-full object-cover"
              />
            ) : (
              <div className="w-full h-56 lg:h-full bg-gradient-to-br from-slate-50 to-sky-50 flex flex-col items-center justify-center p-8 text-center">
                <BookOpen className="w-10 h-10 text-sky-600 mb-3" />
                <p className="font-display text-lg font-semibold text-slate-900">
                  Structured Lecture Synthesis
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  Timestamped notes, active-recall flashcards, and graded comprehension checks.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Editorial 3-Step Workflow Strip */}
      <section className="mt-14 pt-10 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-8">
        <div>
          <p className="font-mono text-xs font-medium text-sky-700 mb-2">01. Extract</p>
          <h2 className="font-sans text-base font-semibold text-slate-900 mb-1.5">
            Automatic Captions &amp; Fallback
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Fetches YouTube metadata and timed captions automatically, with a seamless
            manual transcript editor whenever creators disable captions.
          </p>
        </div>
        <div>
          <p className="font-mono text-xs font-medium text-sky-700 mb-2">02. Synthesize</p>
          <h2 className="font-sans text-base font-semibold text-slate-900 mb-1.5">
            Notes, Quiz &amp; Flashcards
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Distills hour-long talks into executive summaries, chapter breakdowns linked to
            video timestamps, 10+ flashcards, and a graded multiple-choice quiz.
          </p>
        </div>
        <div>
          <p className="font-mono text-xs font-medium text-sky-700 mb-2">03. Master</p>
          <h2 className="font-sans text-base font-semibold text-slate-900 mb-1.5">
            Grounded Q&amp;A &amp; Cloud Sync
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Ask follow-up questions grounded strictly in the speaker&apos;s words and keep your
            flashcard mastery and quiz scores synced to your cloud library.
          </p>
        </div>
      </section>
    </div>
  );
}
