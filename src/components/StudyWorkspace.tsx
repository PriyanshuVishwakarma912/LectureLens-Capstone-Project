import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BookmarkCheck,
  Cloud,
  FileText,
  Plus,
  Search,
} from 'lucide-react';
import {
  formatDurationLabel,
  formatTimestamp,
  type Flashcard,
  type LectureChatMessage,
  type LectureStudyKit,
  type QuizProgress,
} from '../types/lecture';
import { StudyNotesTab } from './StudyNotesTab';
import { QuizTab } from './QuizTab';
import { FlashcardsTab } from './FlashcardsTab';
import { LectureChatTab } from './LectureChatTab';

type StudyTab = 'notes' | 'quiz' | 'flashcards' | 'chat';

interface StudyWorkspaceProps {
  lecture: LectureStudyKit;
  messages: LectureChatMessage[];
  isSavedToCloud: boolean;
  isSavingToCloud: boolean;
  saveError?: string | null;
  isSignedIn: boolean;
  onSaveToCloud: () => void;
  onNewLecture: () => void;
  onUpdateFlashcards: (flashcards: Flashcard[]) => void;
  onUpdateQuizProgress: (progress: QuizProgress) => void;
  onSendChatMessage: (question: string) => Promise<void>;
}

export function StudyWorkspace({
  lecture,
  messages,
  isSavedToCloud,
  isSavingToCloud,
  saveError,
  isSignedIn,
  onSaveToCloud,
  onNewLecture,
  onUpdateFlashcards,
  onUpdateQuizProgress,
  onSendChatMessage,
}: StudyWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<StudyTab>('notes');
  const [transcriptFilter, setTranscriptFilter] = useState('');
  const [activeSeekSec, setActiveSeekSec] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setActiveTab('notes');
    setTranscriptFilter('');
    setActiveSeekSec(null);
  }, [lecture.id]);

  const hasYouTubeVideo = lecture.videoId !== 'manual' && lecture.videoId.length === 11;
  const embedSrc = useMemo(() => {
    const base = `https://www.youtube.com/embed/${lecture.videoId}?enablejsapi=1&rel=0`;
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${base}&origin=${encodeURIComponent(window.location.origin)}`;
    }
    return base;
  }, [lecture.videoId]);

  const handleSeekTo = (seconds: number) => {
    const safeSec = Math.max(0, Math.floor(seconds));
    setActiveSeekSec(safeSec);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({
          event: 'command',
          func: 'seekTo',
          args: [safeSec, true],
        }),
        '*'
      );
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({
          event: 'command',
          func: 'playVideo',
          args: [],
        }),
        '*'
      );
    }
  };

  const filteredTranscript = useMemo(() => {
    const q = transcriptFilter.trim().toLowerCase();
    if (!q) return lecture.transcriptSegments;
    return lecture.transcriptSegments.filter((seg) => seg.text.toLowerCase().includes(q));
  }, [lecture.transcriptSegments, transcriptFilter]);

  const masteredCount = lecture.flashcards.filter((c) => c.status === 'mastered').length;

  return (
    <div className="max-w-[1380px] mx-auto px-6 py-7">
      {/* Lecture Header Strip */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-6 mb-7 border-b border-slate-200">
        <div className="min-w-0">
          <p className="text-xs text-slate-500 mb-1.5">
            <span>{lecture.channelName}</span>
            {formatDurationLabel(lecture.durationSec) && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="tabular-nums">{formatDurationLabel(lecture.durationSec)}</span>
              </>
            )}
            <span aria-hidden="true"> · </span>
            <span>
              {lecture.sourceType === 'youtube_captions'
                ? 'YouTube Captions'
                : 'Manual Transcript'}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="tabular-nums">
              {lecture.studyNotes.sections.length} chapters
            </span>
            <span aria-hidden="true"> · </span>
            <span className="tabular-nums">
              {lecture.transcriptSegments.length} transcript segments
            </span>
          </p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 leading-tight">
            {lecture.title}
          </h1>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2.5 shrink-0">
          {isSavedToCloud ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg whitespace-nowrap shrink-0">
              <BookmarkCheck className="w-3.5 h-3.5" />
              Saved to Cloud Library
            </span>
          ) : (
            <button
              type="button"
              onClick={onSaveToCloud}
              disabled={isSavingToCloud}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Cloud className="w-3.5 h-3.5" />
              {isSavingToCloud
                ? 'Saving...'
                : isSignedIn
                ? 'Save to Library'
                : 'Sign In to Save'}
            </button>
          )}

          <button
            type="button"
            onClick={onNewLecture}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New Lecture
          </button>
        </div>
      </div>

      {saveError && (
        <div
          role="alert"
          className="no-print mb-6 flex items-start gap-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
        >
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <p>{saveError}</p>
        </div>
      )}

      {/* Two-Zone Split Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Stage: Video Player + Searchable Transcript */}
        <aside className="no-print lg:col-span-5 space-y-5 lg:sticky lg:top-24">
          {hasYouTubeVideo ? (
            <div className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-200 shadow-sm aspect-video">
              <iframe
                ref={iframeRef}
                title={lecture.title}
                src={embedSrc}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full border-0"
              />
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
                <FileText className="w-5 h-5 text-sky-600" />
              </div>
              <div>
                <h2 className="font-sans text-sm font-semibold text-slate-900">
                  Text Transcript Mode
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Generated from pasted lecture text without an embedded video stream.
                </p>
              </div>
            </div>
          )}

          {/* Transcript Viewer */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
              <h2 className="font-sans text-sm font-semibold text-slate-900 whitespace-nowrap shrink-0">
                Transcript
              </h2>
              <div className="relative flex-1 max-w-[230px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  aria-label="Search transcript"
                  value={transcriptFilter}
                  onChange={(e) => setTranscriptFilter(e.target.value)}
                  placeholder="Search transcript..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
                />
              </div>
            </div>

            <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-100">
              {filteredTranscript.length === 0 ? (
                <p className="p-6 text-xs text-slate-500 text-center">
                  No transcript segments match &ldquo;{transcriptFilter}&rdquo;.
                </p>
              ) : (
                filteredTranscript.map((seg, idx) => {
                  const isActive =
                    activeSeekSec !== null && Math.abs(seg.startSec - activeSeekSec) < 20;
                  return (
                    <button
                      key={`${seg.startSec}-${idx}`}
                      type="button"
                      onClick={() => handleSeekTo(seg.startSec)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                        isActive ? 'bg-sky-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="font-mono text-xs font-medium text-sky-700 tabular-nums shrink-0 mt-0.5">
                        {formatTimestamp(seg.startSec)}
                      </span>
                      <span className="text-xs sm:text-[13px] text-slate-700 leading-relaxed">
                        {seg.text}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        {/* Right Stage: 4-Mode Study Deck */}
        <section className="lg:col-span-7 print:col-span-12 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm print:border-0 print:rounded-none print:p-0 print:shadow-none">
          {/* Segmented Study Mode Switcher */}
          <div className="no-print flex items-center gap-1 p-1 bg-slate-100 rounded-xl mb-7 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('notes')}
              className={`flex-1 min-w-[110px] px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'notes'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Study Notes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('quiz')}
              className={`flex-1 min-w-[110px] px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                activeTab === 'quiz'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Graded Quiz ({lecture.quizQuestions.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('flashcards')}
              className={`flex-1 min-w-[120px] px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                activeTab === 'flashcards'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Flashcards ({masteredCount}/{lecture.flashcards.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`flex-1 min-w-[110px] px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'chat'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Ask Lecture
            </button>
          </div>

          {activeTab === 'notes' && (
            <StudyNotesTab lecture={lecture} onSeekTo={handleSeekTo} />
          )}
          {activeTab === 'quiz' && (
            <QuizTab
              lecture={lecture}
              onSeekTo={handleSeekTo}
              onUpdateProgress={onUpdateQuizProgress}
            />
          )}
          {activeTab === 'flashcards' && (
            <FlashcardsTab
              lecture={lecture}
              onSeekTo={handleSeekTo}
              onUpdateFlashcards={onUpdateFlashcards}
            />
          )}
          {activeTab === 'chat' && (
            <LectureChatTab
              lecture={lecture}
              messages={messages}
              onSeekTo={handleSeekTo}
              onSendMessage={onSendChatMessage}
            />
          )}
        </section>
      </div>
    </div>
  );
}
