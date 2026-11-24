import { ArrowRight } from 'lucide-react';

interface HowItWorksViewProps {
  onStartWorkspace: () => void;
}

export function HowItWorksView({ onStartWorkspace }: HowItWorksViewProps) {
  return (
    <div className="max-w-[920px] mx-auto px-6 py-12">
      <p className="text-xs font-medium text-sky-700 mb-2">
        Study Methodology · LectureLens Guide
      </p>
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
        From passive video watching to active recall.
      </h1>
      <p className="text-base text-slate-600 leading-relaxed max-w-[65ch] mb-10">
        LectureLens pairs automated YouTube transcript extraction with structured synthesis so
        every concept you watch turns into verifiable notes, flashcard repetition, and
        comprehension checks.
      </p>

      <div className="divide-y divide-slate-200 border-t border-b border-slate-200">
        <div className="py-6 grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-4 font-mono text-xs font-semibold text-sky-700">
            01. Transcript Extraction
          </div>
          <div className="md:col-span-8 text-sm text-slate-700 leading-relaxed">
            Paste any standard <span className="font-mono text-xs">youtube.com</span> or{' '}
            <span className="font-mono text-xs">youtu.be</span> link. LectureLens resolves
            title metadata and extracts timed captions on the server. When a creator disables
            captions, the manual transcript editor opens immediately with your video metadata intact.
          </div>
        </div>

        <div className="py-6 grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-4 font-mono text-xs font-semibold text-sky-700">
            02. Synchronized Study Notes
          </div>
          <div className="md:col-span-8 text-sm text-slate-700 leading-relaxed">
            Every lecture is organized into an executive summary, key takeaways, chronological
            sections, and a domain glossary. Clicking any timestamp reference jumps the embedded
            YouTube player directly to that moment, and you can export clean Markdown or print to PDF.
          </div>
        </div>

        <div className="py-6 grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-4 font-mono text-xs font-semibold text-sky-700">
            03. Graded Quiz &amp; Flashcards
          </div>
          <div className="md:col-span-8 text-sm text-slate-700 leading-relaxed">
            Test your retention immediately with a multiple-choice quiz featuring per-question
            explanations and a missed-questions retake filter. Flip through active-recall flashcards
            using <span className="font-mono text-xs">Space</span> and arrow keys, flagging cards as{' '}
            <em>Needs Review</em> or <em>Mastered</em>.
          </div>
        </div>

        <div className="py-6 grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-4 font-mono text-xs font-semibold text-sky-700">
            04. Grounded Q&amp;A &amp; Cloud Sync
          </div>
          <div className="md:col-span-8 text-sm text-slate-700 leading-relaxed">
            Ask follow-up questions in the Ask Lecture tab—answers cite exact timestamps from the
            transcript rather than drifting off-topic. Sign in with Google to save every study kit,
            quiz score, flashcard status, and chat thread to your Cloud Study Library.
          </div>
        </div>
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={onStartWorkspace}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-sky-600 rounded-xl hover:bg-sky-700 transition-colors"
        >
          Open Study Workspace
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
