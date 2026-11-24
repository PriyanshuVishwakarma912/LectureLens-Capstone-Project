import { useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw, XCircle } from 'lucide-react';
import {
  formatTimestamp,
  type LectureStudyKit,
  type QuizProgress,
} from '../types/lecture';

interface QuizTabProps {
  lecture: LectureStudyKit;
  onSeekTo: (seconds: number) => void;
  onUpdateProgress: (progress: QuizProgress) => void;
}

export function QuizTab({ lecture, onSeekTo, onUpdateProgress }: QuizTabProps) {
  const { quizQuestions, quizProgress } = lecture;
  const [selected, setSelected] = useState<number[]>(() =>
    quizQuestions.map((_, i) => quizProgress.selectedAnswers[i] ?? -1)
  );
  const [submitted, setSubmitted] = useState<boolean>(
    () => quizProgress.attemptCount > 0 && quizProgress.selectedAnswers.some((a) => a >= 0)
  );
  const [retakeIndices, setRetakeIndices] = useState<number[] | null>(null);

  useEffect(() => {
    setSelected(quizQuestions.map((_, i) => quizProgress.selectedAnswers[i] ?? -1));
    setSubmitted(quizProgress.attemptCount > 0 && quizProgress.selectedAnswers.some((a) => a >= 0));
    setRetakeIndices(null);
  }, [lecture.id]);

  const answeredCount = selected.filter((idx) => idx >= 0).length;
  const correctCount = quizQuestions.reduce(
    (acc, q, idx) => (selected[idx] === q.correctIndex ? acc + 1 : acc),
    0
  );
  const accuracyPct = Math.round((correctCount / Math.max(1, quizQuestions.length)) * 100);

  const handleSelectOption = (qIndex: number, optionIndex: number) => {
    if (submitted) return;
    setSelected((prev) => {
      const next = [...prev];
      next[qIndex] = optionIndex;
      return next;
    });
  };

  const handleGradeQuiz = () => {
    const nextBest = Math.max(quizProgress.bestScore, correctCount);
    const nextProgress: QuizProgress = {
      selectedAnswers: selected,
      lastScore: correctCount,
      bestScore: nextBest,
      totalQuestions: quizQuestions.length,
      attemptCount: quizProgress.attemptCount + 1,
    };
    setSubmitted(true);
    onUpdateProgress(nextProgress);
  };

  const handleResetQuiz = (onlyMissed = false) => {
    if (onlyMissed) {
      const missed = quizQuestions
        .map((q, idx) => (selected[idx] !== q.correctIndex ? idx : -1))
        .filter((idx) => idx >= 0);
      setSelected((prev) =>
        prev.map((ans, idx) => (ans === quizQuestions[idx].correctIndex ? ans : -1))
      );
      setRetakeIndices(missed.length > 0 ? missed : null);
    } else {
      setSelected(quizQuestions.map(() => -1));
      setRetakeIndices(null);
    }
    setSubmitted(false);
  };

  const visibleIndices = retakeIndices ?? quizQuestions.map((_, idx) => idx);

  return (
    <div className="space-y-6">
      {/* Score & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="text-xs text-slate-600 tabular-nums">
          {submitted ? (
            <span>
              Score: <strong className="text-slate-900">{correctCount}/{quizQuestions.length}</strong> ({accuracyPct}%) · Best: {Math.max(quizProgress.bestScore, correctCount)}/{quizQuestions.length}
            </span>
          ) : (
            <span>
              Answered <strong className="text-slate-900">{answeredCount}/{quizQuestions.length}</strong> questions
              {quizProgress.bestScore > 0 ? ` · Best Score: ${quizProgress.bestScore}/${quizQuestions.length}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {submitted ? (
            <>
              {correctCount < quizQuestions.length && (
                <button
                  type="button"
                  onClick={() => handleResetQuiz(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 transition-colors whitespace-nowrap shrink-0"
                >
                  Retake Missed ({quizQuestions.length - correctCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => handleResetQuiz(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Quiz
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleGradeQuiz}
              disabled={answeredCount === 0}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
            >
              Grade Quiz
            </button>
          )}
        </div>
      </div>

      {/* Question List */}
      <div className="divide-y divide-slate-200">
        {visibleIndices.map((qIdx) => {
          const item = quizQuestions[qIdx];
          const chosen = selected[qIdx];
          const isCorrect = submitted && chosen === item.correctIndex;
          const isWrong = submitted && chosen !== item.correctIndex;

          return (
            <div key={item.id} className="py-6 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                <h3 className="font-sans text-[15px] font-semibold text-slate-900 leading-snug">
                  <span className="font-mono text-xs text-slate-500 mr-2 tabular-nums">
                    Q{String(qIdx + 1).padStart(2, '0')}
                  </span>
                  {item.question}
                </h3>
                <button
                  type="button"
                  onClick={() => onSeekTo(item.timestampSec)}
                  className="font-mono text-xs text-sky-700 hover:text-sky-800 hover:underline underline-offset-4 tabular-nums whitespace-nowrap shrink-0"
                >
                  Ref {formatTimestamp(item.timestampSec)}
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {item.options.map((opt, optIdx) => {
                  const isSelected = chosen === optIdx;
                  const isAnswer = item.correctIndex === optIdx;

                  let buttonStyle =
                    'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50';
                  let stateTag: string | null = null;

                  if (!submitted && isSelected) {
                    buttonStyle = 'bg-sky-50 border-sky-600 text-slate-900';
                  } else if (submitted && isAnswer) {
                    buttonStyle = 'bg-emerald-50 border-emerald-600 text-emerald-950';
                    stateTag = 'Correct';
                  } else if (submitted && isSelected && !isAnswer) {
                    buttonStyle = 'bg-red-50 border-red-500 text-red-950';
                    stateTag = 'Your Choice';
                  }

                  return (
                    <button
                      key={optIdx}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleSelectOption(qIdx, optIdx)}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors flex items-center justify-between gap-3 ${buttonStyle}`}
                    >
                      <div className="flex items-baseline gap-3">
                        <span className="font-mono text-xs font-medium text-slate-500 shrink-0">
                          {String.fromCharCode(65 + optIdx)}.
                        </span>
                        <span>{opt}</span>
                      </div>
                      {stateTag && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold shrink-0">
                          {isAnswer ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-600" />
                          )}
                          {stateTag}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {submitted && (
                <div
                  className={`mt-3 rounded-xl px-4 py-3 text-sm leading-relaxed border ${
                    isCorrect
                      ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                      : isWrong
                      ? 'bg-slate-50 border-slate-200 text-slate-700'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <span className="font-semibold text-slate-900 mr-1.5">
                    {isCorrect ? 'Correct:' : 'Explanation:'}
                  </span>
                  {item.explanation}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
