import { jsPDF } from 'jspdf';
import { formatDurationLabel, formatTimestamp, type LectureStudyKit } from '../types/lecture';

function sanitizePdfText(input: string): string {
  return (input || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '-')
    .replace(/\u2192/g, '->')
    .replace(/\u2264/g, '<=')
    .replace(/\u2265/g, '>=')
    .replace(/\u2260/g, '!=')
    .replace(/\u00A0/g, ' ')
    // Strip unsupported non-Latin-1 glyphs (e.g. emojis) so built-in PDF fonts never garble
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

export function getSafeFilename(title: string, ext: string): string {
  const safeName = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `${safeName || 'lecture-notes'}.${ext}`;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1500);
}

export function exportLectureNotesPdf(lecture: LectureStudyKit): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 48;
  const marginTop = 52;
  const marginBottom = 52;
  const maxWidth = pageWidth - marginX * 2;
  let y = marginTop;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
    }
  };

  const writeWrappedText = (
    text: string,
    options: {
      fontSize: number;
      lineHeight: number;
      fontStyle?: 'normal' | 'bold' | 'italic';
      color?: [number, number, number];
      indent?: number;
      spaceAfter?: number;
    }
  ) => {
    const clean = sanitizePdfText(text);
    if (!clean.trim()) return;

    const indent = options.indent ?? 0;
    const [r, g, b] = options.color ?? [30, 41, 59];
    doc.setFont('helvetica', options.fontStyle ?? 'normal');
    doc.setFontSize(options.fontSize);
    doc.setTextColor(r, g, b);

    const paragraphs = clean.split(/\r?\n/);
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const para = paragraphs[pIdx].trim();
      if (!para) {
        y += options.lineHeight * 0.55;
        continue;
      }
      const lines = doc.splitTextToSize(para, maxWidth - indent) as string[];
      for (const line of lines) {
        ensureSpace(options.lineHeight);
        doc.text(line, marginX + indent, y);
        y += options.lineHeight;
      }
      if (pIdx < paragraphs.length - 1) {
        y += options.lineHeight * 0.35;
      }
    }

    if (options.spaceAfter) {
      y += options.spaceAfter;
    }
  };

  const drawDivider = (spaceBefore = 6, spaceAfter = 14) => {
    y += spaceBefore;
    ensureSpace(12);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.75);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += spaceAfter;
  };

  const writeSectionHeading = (title: string) => {
    ensureSpace(34);
    writeWrappedText(title, {
      fontSize: 13,
      lineHeight: 18,
      fontStyle: 'bold',
      color: [15, 23, 42],
      spaceAfter: 6,
    });
  };

  // Document Header
  writeWrappedText('LECTURELENS STUDY NOTES', {
    fontSize: 9,
    lineHeight: 13,
    fontStyle: 'bold',
    color: [2, 132, 199],
    spaceAfter: 4,
  });

  writeWrappedText(lecture.title, {
    fontSize: 20,
    lineHeight: 26,
    fontStyle: 'bold',
    color: [15, 23, 42],
    spaceAfter: 6,
  });

  const durationLabel = formatDurationLabel(lecture.durationSec);
  const metaParts = [lecture.channelName, durationLabel, lecture.youtubeUrl].filter(Boolean);
  const sourceLine = metaParts.join('  |  ');
  writeWrappedText(sourceLine, {
    fontSize: 9.5,
    lineHeight: 14,
    color: [100, 116, 139],
    spaceAfter: 4,
  });

  drawDivider(4, 16);

  // Executive Summary
  writeSectionHeading('Executive Summary');
  writeWrappedText(lecture.studyNotes.executiveSummary, {
    fontSize: 10.5,
    lineHeight: 16,
    color: [51, 65, 85],
    spaceAfter: 8,
  });

  // Key Takeaways
  if (lecture.studyNotes.keyTakeaways.length > 0) {
    drawDivider();
    writeSectionHeading('Key Takeaways');
    lecture.studyNotes.keyTakeaways.forEach((item, idx) => {
      const prefix = `${String(idx + 1).padStart(2, '0')}.`;
      ensureSpace(18);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(2, 132, 199);
      doc.text(prefix, marginX, y);

      writeWrappedText(item, {
        fontSize: 10.5,
        lineHeight: 15.5,
        color: [51, 65, 85],
        indent: 22,
        spaceAfter: 4,
      });
    });
  }

  // Topic Breakdown
  if (lecture.studyNotes.sections.length > 0) {
    drawDivider();
    writeSectionHeading('Topic Breakdown');
    lecture.studyNotes.sections.forEach((section, idx) => {
      ensureSpace(44);
      const heading = `${String(idx + 1).padStart(2, '0')}. ${section.heading}  [${formatTimestamp(section.timestampSec)}]`;
      writeWrappedText(heading, {
        fontSize: 11.5,
        lineHeight: 16,
        fontStyle: 'bold',
        color: [15, 23, 42],
        spaceAfter: 4,
      });

      if (section.summary) {
        writeWrappedText(section.summary, {
          fontSize: 10,
          lineHeight: 15,
          color: [71, 85, 105],
          spaceAfter: 5,
        });
      }

      section.bulletPoints.forEach((pt) => {
        ensureSpace(16);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139);
        doc.text('-', marginX + 6, y);

        writeWrappedText(pt, {
          fontSize: 10,
          lineHeight: 14.5,
          color: [51, 65, 85],
          indent: 18,
          spaceAfter: 3,
        });
      });

      y += 8;
    });
  }

  // Key Glossary
  if (lecture.studyNotes.glossary.length > 0) {
    drawDivider();
    writeSectionHeading('Key Concepts & Terminology');
    lecture.studyNotes.glossary.forEach((entry) => {
      ensureSpace(32);
      writeWrappedText(entry.term, {
        fontSize: 10.5,
        lineHeight: 14.5,
        fontStyle: 'bold',
        color: [15, 23, 42],
        spaceAfter: 2,
      });
      writeWrappedText(entry.definition, {
        fontSize: 10,
        lineHeight: 14.5,
        color: [71, 85, 105],
        spaceAfter: 7,
      });
    });
  }

  // Page numbers footer
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `LectureLens  -  Page ${p} of ${totalPages}`,
      pageWidth - marginX,
      pageHeight - 24,
      { align: 'right' }
    );
  }

  const pdfBlob = doc.output('blob');
  triggerBlobDownload(pdfBlob, getSafeFilename(lecture.title, 'pdf'));
}
