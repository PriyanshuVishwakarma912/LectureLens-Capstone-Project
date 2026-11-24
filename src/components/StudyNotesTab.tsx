import { useMemo, useState } from 'react';
import { Download, FileDown, Printer, Search } from 'lucide-react';
import {
  exportLectureNotesPdf,
  getSafeFilename,
  triggerBlobDownload,
} from '../lib/exportNotesPdf';
import { formatDurationLabel, formatTimestamp, type LectureStudyKit } from '../types/lecture';

interface StudyNotesTabProps {
  lecture: LectureStudyKit;
  onSeekTo: (seconds: number) => void;
}

export function StudyNotesTab({ lecture, onSeekTo }: StudyNotesTabProps) {
  const { studyNotes } = lecture;
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [topicFilter, setTopicFilter] = useState('');

  const durationLabel = formatDurationLabel(lecture.durationSec);

  const filteredSections = useMemo(() => {
    const q = topicFilter.trim().toLowerCase();
    const indexed = studyNotes.sections.map((section, idx) => ({ section, originalIdx: idx }));
    if (!q) return indexed;
    return indexed.filter(
      ({ section }) =>
        section.heading.toLowerCase().includes(q) ||
        section.summary.toLowerCase().includes(q) ||
        section.bulletPoints.some((pt) => pt.toLowerCase().includes(q))
    );
  }, [studyNotes.sections, topicFilter]);

  const handleExportMarkdown = () => {
    setExportNotice(null);
    const lines: string[] = [
      `# ${lecture.title}`,
      '',
      `Source: ${lecture.channelName}${durationLabel ? ` (${durationLabel})` : ''} · ${lecture.youtubeUrl}`,
      '',
      '## Executive Summary',
      studyNotes.executiveSummary,
      '',
      '## Key Takeaways',
      ...studyNotes.keyTakeaways.map((item) => `- ${item}`),
      '',
      '## Sectioned Lecture Notes',
      ...studyNotes.sections.flatMap((sec, idx) => [
        `### ${String(idx + 1).padStart(2, '0')}. ${sec.heading} [${formatTimestamp(sec.timestampSec)}]`,
        sec.summary,
        '',
        ...sec.bulletPoints.map((pt) => `- ${pt}`),
        '',
      ]),
      '## Key Glossary',
      ...studyNotes.glossary.map((g) => `- **${g.term}**: ${g.definition}`),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    triggerBlobDownload(blob, getSafeFilename(lecture.title, 'md'));
    setExportNotice('Markdown notes downloaded.');
  };

  const handleDownloadPdf = () => {
    setExportNotice(null);
    try {
      exportLectureNotesPdf(lecture);
      setExportNotice('PDF study notes downloaded.');
    } catch {
      setExportNotice('Could not generate PDF. Please try Export Markdown instead.');
    }
  };

  const handlePrint = () => {
    setExportNotice(null);
    let printTriggered = false;
    const onBeforePrint = () => {
      printTriggered = true;
    };
    window.addEventListener('beforeprint', onBeforePrint, { once: true });

    try {
      window.print();
    } catch {
      // Sandboxed iframe may block window.print()
    }

    window.setTimeout(() => {
      window.removeEventListener('beforeprint', onBeforePrint);
      if (!printTriggered) {
        try {
          exportLectureNotesPdf(lecture);
          setExportNotice(
            'Browser print is blocked in this preview window — downloaded a PDF copy instead.'
          );
        } catch {
          setExportNotice('Unable to open print dialog here. Use Download PDF instead.');
        }
      }
    }, 350);
  };

  return (
    <div className="space-y-8">
      {/* Toolbar */}
      <div className="no-print space-y-2 pb-4 border-b border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 tabular-nums">
            {durationLabel ? `${durationLabel} · ` : ''}
            {studyNotes.sections.length} chapters · {studyNotes.keyTakeaways.length} takeaways ·{' '}
            {studyNotes.glossary.length} terms
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Export Markdown
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded-lg hover:bg-sky-100 hover:text-sky-800 transition-colors whitespace-nowrap shrink-0"
            >
              <FileDown className="w-3.5 h-3.5" />
              Download PDF
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
          </div>
        </div>
        {exportNotice && (
          <p role="status" className="text-xs text-sky-700">
            {exportNotice}
          </p>
        )}
      </div>

      {/* Executive Summary */}
      <section className="max-w-[70ch]">
        <h3 className="font-sans text-sm font-semibold text-slate-900 mb-2.5">
          Executive Summary
        </h3>
        <p className="text-[15px] text-slate-700 leading-[1.7] whitespace-pre-line">
          {studyNotes.executiveSummary}
        </p>
      </section>

      {/* Key Takeaways */}
      <section className="pt-6 border-t border-slate-200 max-w-[70ch]">
        <h3 className="font-sans text-sm font-semibold text-slate-900 mb-3">
          Key Takeaways
        </h3>
        <ol className="space-y-2.5">
          {studyNotes.keyTakeaways.map((item, idx) => (
            <li key={idx} className="flex items-baseline gap-3 text-[15px] text-slate-700 leading-relaxed">
              <span className="font-mono text-xs font-medium text-sky-700 tabular-nums shrink-0">
                {String(idx + 1).padStart(2, '0')}.
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Chapter Index for Long Lectures */}
      {studyNotes.sections.length > 8 && (
        <section className="no-print pt-6 border-t border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h3 className="font-sans text-sm font-semibold text-slate-900">
              Chapter Outline ({studyNotes.sections.length} topics)
            </h3>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Filter lecture topics"
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                placeholder="Filter chapters or concepts..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl bg-slate-50/50 p-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {studyNotes.sections.map((section, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  if (topicFilter) setTopicFilter('');
                  window.setTimeout(() => {
                    document
                      .getElementById(`note-chapter-${idx}`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 30);
                }}
                className="text-left text-xs text-slate-700 hover:text-sky-700 py-1 flex items-baseline gap-2 truncate"
              >
                <span className="font-mono text-[11px] text-sky-700 tabular-nums shrink-0">
                  {formatTimestamp(section.timestampSec)}
                </span>
                <span className="truncate">
                  {String(idx + 1).padStart(2, '0')}. {section.heading}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Sectioned Chapters */}
      <section className="pt-6 border-t border-slate-200 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-sans text-sm font-semibold text-slate-900">
            Topic Breakdown
            {topicFilter.trim() && (
              <span className="ml-2 font-normal text-xs text-slate-500">
                ({filteredSections.length} matching)
              </span>
            )}
          </h3>
          {topicFilter.trim() && (
            <button
              type="button"
              onClick={() => setTopicFilter('')}
              className="no-print text-xs font-medium text-sky-700 hover:underline"
            >
              Show all {studyNotes.sections.length} chapters
            </button>
          )}
        </div>
        <div className="divide-y divide-slate-200">
          {filteredSections.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">
              No chapters match &ldquo;{topicFilter}&rdquo;.
            </p>
          ) : (
            filteredSections.map(({ section, originalIdx }) => (
              <article
                id={`note-chapter-${originalIdx}`}
                key={originalIdx}
                className="py-5 first:pt-0 last:pb-0 max-w-[70ch]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-2">
                  <h4 className="font-sans text-base font-semibold text-slate-900">
                    {String(originalIdx + 1).padStart(2, '0')}. {section.heading}
                  </h4>
                  <button
                    type="button"
                    onClick={() => onSeekTo(section.timestampSec)}
                    className="no-print font-mono text-xs font-medium text-sky-700 hover:text-sky-800 hover:underline underline-offset-4 tabular-nums whitespace-nowrap shrink-0"
                  >
                    Jump {formatTimestamp(section.timestampSec)}
                  </button>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed mb-3">
                  {section.summary}
                </p>
                <ul className="space-y-1.5 pl-4 list-disc marker:text-slate-400">
                  {section.bulletPoints.map((pt, bIdx) => (
                    <li key={bIdx} className="text-sm text-slate-700 leading-relaxed">
                      {pt}
                    </li>
                  ))}
                </ul>
              </article>
            ))
          )}
        </div>
      </section>

      {/* Key Glossary */}
      {studyNotes.glossary.length > 0 && (
        <section className="pt-6 border-t border-slate-200">
          <h3 className="font-sans text-sm font-semibold text-slate-900 mb-4">
            Key Concepts &amp; Terminology
          </h3>
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {studyNotes.glossary.map((entry, idx) => (
              <div key={idx} className="pb-3 border-b border-slate-100">
                <dt className="text-sm font-semibold text-slate-900 mb-1">
                  {entry.term}
                </dt>
                <dd className="text-sm text-slate-600 leading-relaxed">
                  {entry.definition}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
