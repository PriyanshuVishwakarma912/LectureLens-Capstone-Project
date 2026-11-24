import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowUp, Loader2 } from 'lucide-react';
import {
  formatTimestamp,
  type LectureChatMessage,
  type LectureStudyKit,
} from '../types/lecture';

interface LectureChatTabProps {
  lecture: LectureStudyKit;
  messages: LectureChatMessage[];
  onSeekTo: (seconds: number) => void;
  onSendMessage: (question: string) => Promise<void>;
}

export function LectureChatTab({
  lecture,
  messages,
  onSeekTo,
  onSendMessage,
}: LectureChatTabProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const starterPrompts = useMemo(() => {
    const firstSection = lecture.studyNotes.sections[0]?.heading;
    const firstTerm = lecture.studyNotes.glossary[0]?.term;
    return [
      'What is the main argument or core thesis of this lecture?',
      firstSection
        ? `Walk me through "${firstSection}" step by step.`
        : 'What examples does the speaker use to illustrate the main concept?',
      firstTerm
        ? `How does the lecture define and apply "${firstTerm}"?`
        : 'What are the most important takeaways to remember for an exam?',
    ];
  }, [lecture.id]);

  const handleSubmit = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || sending) return;
    setError(null);
    setSending(true);
    setInput('');
    try {
      await onSendMessage(trimmed);
      requestAnimationFrame(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send your question.');
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  };

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void handleSubmit(input);
  };

  return (
    <div className="flex flex-col h-[540px]">
      <div className="pb-3 border-b border-slate-200 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-sans text-sm font-semibold text-slate-900">
            Ask the Lecture
          </h3>
          <p className="text-xs text-slate-500">
            Answers are grounded strictly in this lecture&apos;s transcript with clickable timestamp citations.
          </p>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto py-4 space-y-5 pr-1">
        {messages.length === 0 ? (
          <div className="py-6 space-y-4">
            <p className="text-sm text-slate-600">
              Ask any question about concepts, derivations, or examples covered in{' '}
              <span className="font-medium text-slate-900">{lecture.title}</span>.
            </p>
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500">Suggested questions</p>
              <div className="flex flex-col gap-2 items-start">
                {starterPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={sending}
                    onClick={() => void handleSubmit(prompt)}
                    className="text-left text-sm text-sky-800 bg-sky-50/70 hover:bg-sky-100/80 border border-sky-200 rounded-xl px-3.5 py-2 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <span className="text-[11px] font-medium text-slate-400 mb-1">
                {msg.role === 'user' ? 'You' : 'LectureLens Tutor'}
              </span>
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line ${
                  msg.role === 'user'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-800'
                }`}
              >
                {msg.content}

                {msg.role === 'assistant' && msg.timestampRefs.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-200/80 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-500">Cited moments:</span>
                    {msg.timestampRefs.map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => onSeekTo(sec)}
                        className="font-mono font-medium text-sky-700 hover:text-sky-800 hover:underline underline-offset-4 tabular-nums"
                      >
                        {formatTimestamp(sec)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
            Checking transcript and composing response...
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={onFormSubmit} className="pt-3 border-t border-slate-200 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          placeholder="Ask a question about this lecture..."
          className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Send question"
          className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
