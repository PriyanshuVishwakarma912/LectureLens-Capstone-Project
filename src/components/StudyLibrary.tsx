import { useMemo, useState } from 'react';
import { AlertCircle, BookOpen, LogIn, Plus, Search, Trash2, Youtube } from 'lucide-react';
import type { User } from '../lib/firebase';
import { formatDurationLabel, type LectureStudyKit } from '../types/lecture';

interface StudyLibraryProps {
  user: User | null;
  lectures: LectureStudyKit[];
  loading: boolean;
  onSignIn: () => void;
  onOpenLecture: (lecture: LectureStudyKit) => void;
  onDeleteLecture: (lectureId: string) => Promise<void>;
  onCreateNew: () => void;
}

export function StudyLibrary({
  user,
  lectures,
  loading,
  onSignIn,
  onOpenLecture,
  onDeleteLecture,
  onCreateNew,
}: StudyLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});

  const filteredLectures = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return lectures;
    return lectures.filter(
      (lec) =>
        lec.title.toLowerCase().includes(q) || lec.channelName.toLowerCase().includes(q)
    );
  }, [lectures, searchQuery]);

  if (!user) {
    return (
      <div className="max-w-[780px] mx-auto px-6 py-16 text-center">
        <div className="bg-white border border-slate-200 rounded-2xl p-10 shadow-sm">
          <BookOpen className="w-10 h-10 text-sky-600 mx-auto mb-4" />
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mb-3">
            Your Cloud Study Library
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed max-w-md mx-auto mb-7">
            Sign in with Google to save generated lecture notes, track flashcard mastery across
            devices, and retain your quiz history and Q&amp;A threads.
          </p>
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-xl hover:bg-sky-700 transition-colors"
          >
            <LogIn className="w-4 h-4" />
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 mb-8 border-b border-slate-200">
        <div>
          <p className="text-xs text-slate-500 mb-1">
            {user.email} · {lectures.length} saved {lectures.length === 1 ? 'lecture' : 'lectures'}
          </p>
          <h1 className="font-display text-3xl font-bold text-slate-900">
            Study Library
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label="Filter saved lectures"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search lectures..."
              className="pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600 w-56"
            />
          </div>
          <button
            type="button"
            onClick={onCreateNew}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-xl hover:bg-sky-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Lecture
          </button>
        </div>
      </div>

      {deleteError && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3"
        >
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <p>{deleteError}</p>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-64 bg-white border border-slate-200 rounded-2xl animate-pulse"
            />
          ))}
        </div>
      ) : filteredLectures.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
          <p className="font-display text-xl font-semibold text-slate-900 mb-2">
            {lectures.length === 0 ? 'No saved lectures yet' : 'No matching lectures'}
          </p>
          <p className="text-sm text-slate-600 mb-6">
            {lectures.length === 0
              ? 'Generate study notes from any YouTube lecture to build your library.'
              : `No saved study kits match "${searchQuery}".`}
          </p>
          <button
            type="button"
            onClick={lectures.length === 0 ? onCreateNew : () => setSearchQuery('')}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-xl hover:bg-sky-700 transition-colors"
          >
            {lectures.length === 0 ? 'Analyze a Lecture' : 'Clear Search'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredLectures.map((lec) => {
            const mastered = lec.flashcards.filter((c) => c.status === 'mastered').length;
            const hasThumb = Boolean(lec.thumbnailUrl) && !brokenThumbs[lec.id];

            return (
              <article
                key={lec.id}
                className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm flex flex-col justify-between"
              >
                <div>
                  <button
                    type="button"
                    onClick={() => onOpenLecture(lec)}
                    className="w-full text-left block group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                  >
                    <div className="aspect-video bg-slate-100 border-b border-slate-200 overflow-hidden">
                      {hasThumb ? (
                        <img
                          src={lec.thumbnailUrl}
                          alt={lec.title}
                          referrerPolicy="no-referrer"
                          onError={() =>
                            setBrokenThumbs((prev) => ({ ...prev, [lec.id]: true }))
                          }
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-sky-50 text-slate-400">
                          <Youtube className="w-7 h-7 text-sky-600 mb-1" />
                          <span className="text-xs text-slate-500">Lecture Study Kit</span>
                        </div>
                      )}
                    </div>

                    <div className="p-5 pb-3">
                      <h2 className="font-sans text-base font-semibold text-slate-900 group-hover:text-sky-700 transition-colors line-clamp-2 mb-1.5">
                        {lec.title}
                      </h2>
                      <p className="text-xs text-slate-500 truncate tabular-nums">
                        <span>{lec.channelName}</span>
                        {formatDurationLabel(lec.durationSec) && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>{formatDurationLabel(lec.durationSec)}</span>
                          </>
                        )}
                        <span aria-hidden="true"> · </span>
                        <span>{lec.studyNotes.sections.length} chapters</span>
                      </p>
                    </div>
                  </button>
                </div>

                <div className="px-5 pb-5 pt-2 flex items-center justify-between gap-3 border-t border-slate-100 mt-2">
                  <div className="text-xs text-slate-600 tabular-nums">
                    <span>
                      Quiz Best: {lec.quizProgress.bestScore}/{lec.quizProgress.totalQuestions}
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span>
                      Cards: {mastered}/{lec.flashcards.length}
                    </span>
                  </div>

                  {confirmDeleteId === lec.id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={deletingId === lec.id}
                        onClick={async () => {
                          setDeleteError(null);
                          setDeletingId(lec.id);
                          try {
                            await onDeleteLecture(lec.id);
                            setConfirmDeleteId(null);
                          } catch (err) {
                            setDeleteError(
                              err instanceof Error
                                ? err.message
                                : 'Could not delete lecture. Please try again.'
                            );
                          } finally {
                            setDeletingId(null);
                          }
                        }}
                        className="text-xs font-semibold text-red-600 hover:text-red-700"
                      >
                        {deletingId === lec.id ? 'Removing...' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs text-slate-500 hover:text-slate-800"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Delete ${lec.title}`}
                      onClick={() => setConfirmDeleteId(lec.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
