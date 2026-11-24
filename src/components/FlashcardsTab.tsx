import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  RefreshCw,
} from 'lucide-react';
import {
  formatTimestamp,
  type Flashcard,
  type FlashcardStatus,
  type LectureStudyKit,
} from '../types/lecture';

interface FlashcardsTabProps {
  lecture: LectureStudyKit;
  onSeekTo: (seconds: number) => void;
  onUpdateFlashcards: (flashcards: Flashcard[]) => void;
}

type DeckFilter = 'all' | 'review' | 'mastered';

export function FlashcardsTab({
  lecture,
  onSeekTo,
  onUpdateFlashcards,
}: FlashcardsTabProps) {
  const [filter, setFilter] = useState<DeckFilter>('all');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const masteredCount = lecture.flashcards.filter((c) => c.status === 'mastered').length;
  const reviewCount = lecture.flashcards.filter((c) => c.status === 'review').length;

  const filteredCards = useMemo(() => {
    if (filter === 'review') {
      return lecture.flashcards.filter((c) => c.status === 'review' || c.status === 'new');
    }
    if (filter === 'mastered') {
      return lecture.flashcards.filter((c) => c.status === 'mastered');
    }
    return lecture.flashcards;
  }, [lecture.flashcards, filter]);

  const safeIndex = filteredCards.length > 0 ? Math.min(currentIndex, filteredCards.length - 1) : 0;
  const activeCard = filteredCards[safeIndex] ?? null;

  useEffect(() => {
    setCurrentIndex(0);
    setFlipped(false);
  }, [lecture.id, filter]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (filteredCards.length === 0) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setFlipped(false);
        setCurrentIndex((i) => (i + 1) % filteredCards.length);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setFlipped(false);
        setCurrentIndex((i) => (i - 1 + filteredCards.length) % filteredCards.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filteredCards.length]);

  const handleMarkStatus = (status: FlashcardStatus) => {
    if (!activeCard) return;
    const updated = lecture.flashcards.map((c) =>
      c.id === activeCard.id ? { ...c, status } : c
    );
    onUpdateFlashcards(updated);
    setFlipped(false);

    const leavesCurrentFilter =
      (filter === 'review' && status === 'mastered') ||
      (filter === 'mastered' && status !== 'mastered');

    if (leavesCurrentFilter) {
      // Next card shifts into safeIndex automatically once activeCard is removed from filter
      const remainingCount = Math.max(0, filteredCards.length - 1);
      setCurrentIndex(remainingCount > 0 ? Math.min(safeIndex, remainingCount - 1) : 0);
    } else if (filteredCards.length > 1) {
      setCurrentIndex((i) => (i + 1) % filteredCards.length);
    }
  };

  const handleResetDeck = () => {
    const reset = lecture.flashcards.map((c) => ({ ...c, status: 'new' as const }));
    onUpdateFlashcards(reset);
    setFilter('all');
    setCurrentIndex(0);
    setFlipped(false);
  };

  return (
    <div className="space-y-6">
      {/* Filter & Mastery Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filter === 'all'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({lecture.flashcards.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('review')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filter === 'review'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            To Review ({lecture.flashcards.length - masteredCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter('mastered')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              filter === 'mastered'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Mastered ({masteredCount})
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-600 tabular-nums">
          <span>
            {masteredCount}/{lecture.flashcards.length} Mastered
            {reviewCount > 0 ? ` · ${reviewCount} Flagged` : ''}
          </span>
          {(masteredCount > 0 || reviewCount > 0) && (
            <button
              type="button"
              onClick={handleResetDeck}
              className="text-slate-500 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Reset Progress
            </button>
          )}
        </div>
      </div>

      {/* Mastery Progress Bar */}
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-emerald-600 transition-transform duration-200 origin-left"
          style={{
            transform: `scaleX(${
              lecture.flashcards.length > 0 ? masteredCount / lecture.flashcards.length : 0
            })`,
          }}
        />
      </div>

      {activeCard ? (
        <div className="space-y-5">
          {/* Interactive 3D Flip Card */}
          <div className="perspective-1000">
            <div
              role="button"
              tabIndex={0}
              aria-label={flipped ? 'Flashcard answer side. Click to flip to question.' : 'Flashcard question side. Click to reveal answer.'}
              onClick={() => setFlipped((f) => !f)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setFlipped((f) => !f);
                }
              }}
              className={`grid grid-cols-1 w-full min-h-[260px] cursor-pointer transition-transform duration-200 transform-style-3d ${
                flipped ? 'rotate-y-180' : ''
              }`}
            >
              {/* Front */}
              <div className="col-start-1 row-start-1 w-full h-full backface-hidden bg-slate-50/70 border border-slate-200 rounded-2xl p-7 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-4 text-xs text-slate-500">
                  <span className="font-mono tabular-nums">
                    Card {safeIndex + 1} of {filteredCards.length} · Prompt
                  </span>
                  <span className="font-medium text-slate-600">
                    {activeCard.status === 'mastered'
                      ? 'Mastered'
                      : activeCard.status === 'review'
                      ? 'Needs Review'
                      : 'Unreviewed'}
                  </span>
                </div>

                <p className="font-display text-xl sm:text-2xl font-semibold text-slate-900 leading-snug text-center my-6 break-words">
                  {activeCard.front}
                </p>

                <div className="flex items-center justify-between text-xs text-slate-500">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeekTo(activeCard.timestampSec);
                    }}
                    className="font-mono text-sky-700 hover:underline underline-offset-4 tabular-nums"
                  >
                    Video {formatTimestamp(activeCard.timestampSec)}
                  </button>
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <RotateCw className="w-3.5 h-3.5" />
                    Click or press Space to flip
                  </span>
                </div>
              </div>

              {/* Back */}
              <div className="col-start-1 row-start-1 w-full h-full backface-hidden rotate-y-180 bg-white border border-sky-200 rounded-2xl p-7 flex flex-col justify-between shadow-sm">
                <div className="flex items-center justify-between gap-4 text-xs text-sky-700">
                  <span className="font-mono tabular-nums">
                    Card {safeIndex + 1} of {filteredCards.length} · Answer
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSeekTo(activeCard.timestampSec);
                    }}
                    className="font-mono hover:underline underline-offset-4 tabular-nums"
                  >
                    Jump {formatTimestamp(activeCard.timestampSec)}
                  </button>
                </div>

                <p className="text-base sm:text-lg text-slate-800 leading-relaxed text-center my-6 max-w-[54ch] mx-auto break-words">
                  {activeCard.back}
                </p>

                <div className="text-center text-xs text-slate-400">
                  Rate your recall below or press Space to flip back
                </div>
              </div>
            </div>
          </div>

          {/* Navigation & Self-Grading Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setFlipped(false);
                  setCurrentIndex((i) => (i - 1 + filteredCards.length) % filteredCards.length);
                }}
                aria-label="Previous flashcard"
                className="p-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-mono text-xs text-slate-600 tabular-nums px-2">
                {safeIndex + 1} / {filteredCards.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  setFlipped(false);
                  setCurrentIndex((i) => (i + 1) % filteredCards.length);
                }}
                aria-label="Next flashcard"
                className="p-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleMarkStatus('review')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Needs Review
              </button>
              <button
                type="button"
                onClick={() => handleMarkStatus('mastered')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                Mastered
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-12 text-center bg-slate-50 border border-slate-200 rounded-2xl">
          <p className="text-sm font-medium text-slate-800 mb-1">
            No flashcards in this filter
          </p>
          <p className="text-xs text-slate-500 mb-4">
            Switch back to All Cards to continue practicing.
          </p>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors"
          >
            Show All Cards
          </button>
        </div>
      )}
    </div>
  );
}
