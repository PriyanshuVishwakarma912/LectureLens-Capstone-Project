/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import {
  auth,
  onAuthStateChanged,
  signInWithGoogle,
  signOutUser,
  type User,
} from './lib/firebase';
import {
  deleteLectureFromCloud,
  saveChatMessageToCloud,
  saveLectureToCloud,
  subscribeLectureMessages,
  subscribeUserLectures,
  updateFlashcardsInCloud,
  updateQuizProgressInCloud,
  upsertUserProfile,
} from './lib/lectureStore';
import type {
  Flashcard,
  LectureChatMessage,
  LectureStudyKit,
  QuizProgress,
  TranscriptSegment,
  TranscriptSourceType,
  VideoMeta,
} from './types/lecture';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TopBar, type ActiveView } from './components/TopBar';
import { LectureIntakeHero, type IngestionStage } from './components/LectureIntakeHero';
import { StudyWorkspace } from './components/StudyWorkspace';
import { StudyLibrary } from './components/StudyLibrary';
import { HowItWorksView } from './components/HowItWorksView';

function LectureLensApp() {
  const [activeView, setActiveView] = useState<ActiveView>('workspace');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [libraryLectures, setLibraryLectures] = useState<LectureStudyKit[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  // Ingestion flow state
  const [stage, setStage] = useState<IngestionStage>('idle');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [manualTranscriptText, setManualTranscriptText] = useState('');
  const [pendingVideoMeta, setPendingVideoMeta] = useState<VideoMeta | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  // Active study workspace state
  const [activeLecture, setActiveLecture] = useState<LectureStudyKit | null>(null);
  const [savedLectureIds, setSavedLectureIds] = useState<Record<string, boolean>>({});
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Chat state (cloud-synced when saved, in-memory for guest preview)
  const [cloudMessages, setCloudMessages] = useState<LectureChatMessage[]>([]);
  const [guestMessages, setGuestMessages] = useState<LectureChatMessage[]>([]);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        void upsertUserProfile(nextUser).catch((err) => {
          console.error('Profile sync error:', err);
        });
      } else {
        setLibraryLectures([]);
        setSavedLectureIds({});
        setCloudMessages([]);
      }
    });
    return () => unsub();
  }, []);

  // Cloud library listener
  useEffect(() => {
    if (!authReady || !user) {
      setLibraryLoading(false);
      return;
    }
    setLibraryLoading(true);
    const unsub = subscribeUserLectures(
      user.uid,
      (lectures) => {
        setLibraryLectures(lectures);
        const idMap: Record<string, boolean> = {};
        for (const l of lectures) {
          idMap[l.id] = true;
        }
        setSavedLectureIds(idMap);
        setLibraryLoading(false);
      },
      () => {
        setLibraryLoading(false);
      }
    );
    return () => unsub();
  }, [authReady, user]);

  // Cloud chat messages listener for active saved lecture
  const isSavedToCloud = Boolean(user && activeLecture && savedLectureIds[activeLecture.id]);

  useEffect(() => {
    if (!authReady || !user || !activeLecture || !savedLectureIds[activeLecture.id]) {
      setCloudMessages([]);
      return;
    }
    const unsub = subscribeLectureMessages(
      user.uid,
      activeLecture.id,
      (msgs) => {
        setCloudMessages(msgs);
      },
      (err) => {
        setSaveError(err.message);
      }
    );
    return () => unsub();
  }, [authReady, user, activeLecture?.id, savedLectureIds]);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : 'Google Sign-In was cancelled.');
    }
  };

  const handleSignOut = async () => {
    try {
      await signOutUser();
    } catch (err) {
      console.error('Sign-out error:', err);
    }
  };

  const runStudyKitGeneration = async (payload: {
    videoMeta: VideoMeta;
    transcriptSegments?: TranscriptSegment[];
    manualTranscriptText?: string;
    sourceType: TranscriptSourceType;
  }) => {
    setStage('generating_study_kit');
    setIntakeError(null);

    const res = await fetch('/api/lectures/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to synthesize study material.');
    }

    const parsedDuration =
      typeof data.durationSec === 'number' && Number.isFinite(data.durationSec) && data.durationSec >= 0
        ? Math.floor(data.durationSec)
        : typeof data.videoMeta?.durationSec === 'number' &&
            Number.isFinite(data.videoMeta.durationSec) &&
            data.videoMeta.durationSec >= 0
          ? Math.floor(data.videoMeta.durationSec)
          : undefined;

    const baseLecture: Omit<LectureStudyKit, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'> = {
      videoId: data.videoMeta.videoId,
      youtubeUrl: data.videoMeta.youtubeUrl,
      title: data.videoMeta.title,
      channelName: data.videoMeta.channelName,
      thumbnailUrl: data.videoMeta.thumbnailUrl,
      sourceType: data.sourceType,
      ...(parsedDuration !== undefined ? { durationSec: parsedDuration } : {}),
      transcriptSegments: data.transcriptSegments,
      studyNotes: data.studyNotes,
      flashcards: data.flashcards,
      quizQuestions: data.quizQuestions,
      quizProgress: {
        selectedAnswers: data.quizQuestions.map(() => -1),
        lastScore: 0,
        bestScore: 0,
        totalQuestions: data.quizQuestions.length,
        attemptCount: 0,
      },
    };

    setSaveError(null);
    if (user) {
      try {
        const saved = await saveLectureToCloud(user.uid, baseLecture);
        setSavedLectureIds((prev) => ({ ...prev, [saved.id]: true }));
        setActiveLecture(saved);
      } catch (err) {
        const localId = `guest_${Date.now()}`;
        setActiveLecture({
          ...baseLecture,
          id: localId,
          ownerId: user.uid,
        });
        setSaveError(
          err instanceof Error
            ? `Study kit generated, but cloud sync failed (${err.message}). Click Save to Library to retry.`
            : 'Study kit generated, but cloud sync failed. Click Save to Library to retry.'
        );
      }
    } else {
      const localId = `guest_${Date.now()}`;
      setActiveLecture({
        ...baseLecture,
        id: localId,
        ownerId: 'guest',
      });
    }

    setGuestMessages([]);
    setStage('idle');
    setPendingVideoMeta(null);
    setFallbackReason(null);
    setManualTranscriptText('');
    setActiveView('workspace');
  };

  const handleSubmitUrl = async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    setIntakeError(null);
    setFallbackReason(null);
    setStage('fetching_transcript');

    try {
      const res = await fetch('/api/lectures/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to inspect YouTube link.');
      }

      if (data.requiresManualTranscript) {
        setPendingVideoMeta(data.videoMeta);
        setFallbackReason(
          data.reason ||
            'Automatic captions are unavailable for this video. Paste the transcript below to generate notes.'
        );
        setStage('needs_manual_transcript');
        return;
      }

      await runStudyKitGeneration({
        videoMeta: data.videoMeta,
        transcriptSegments: data.transcriptSegments,
        sourceType: 'youtube_captions',
      });
    } catch (err) {
      setStage('idle');
      setIntakeError(err instanceof Error ? err.message : 'Unable to process YouTube link.');
    }
  };

  const handleSubmitManualTranscript = async () => {
    const text = manualTranscriptText.trim();
    if (text.length < 30) {
      setIntakeError('Please paste at least a short paragraph of lecture transcript text.');
      return;
    }

    const meta: VideoMeta = pendingVideoMeta ?? {
      videoId: 'manual',
      youtubeUrl: youtubeUrl.trim() || 'manual',
      title: 'Pasted Lecture Transcript',
      channelName: 'Manual Transcript',
      thumbnailUrl: '',
    };

    try {
      await runStudyKitGeneration({
        videoMeta: meta,
        manualTranscriptText: text,
        sourceType: 'manual_transcript',
      });
    } catch (err) {
      setStage('needs_manual_transcript');
      setIntakeError(err instanceof Error ? err.message : 'Unable to generate study kit.');
    }
  };

  const handleSaveToCloud = async () => {
    if (!activeLecture) return;
    setIsSavingToCloud(true);
    setSaveError(null);
    try {
      let currentUser = user;
      if (!currentUser) {
        currentUser = await signInWithGoogle();
        await upsertUserProfile(currentUser);
      }

      const { id: _oldId, ownerId: _oldOwner, createdAt: _c, updatedAt: _u, ...rest } =
        activeLecture;
      const saved = await saveLectureToCloud(currentUser.uid, rest);
      setSavedLectureIds((prev) => ({ ...prev, [saved.id]: true }));
      setActiveLecture(saved);

      for (const msg of guestMessages) {
        await saveChatMessageToCloud(currentUser.uid, saved.id, {
          role: msg.role,
          content: msg.content,
          timestampRefs: msg.timestampRefs,
        });
      }
      setGuestMessages([]);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Unable to save lecture to Cloud Library.'
      );
    } finally {
      setIsSavingToCloud(false);
    }
  };

  const handleUpdateFlashcards = (flashcards: Flashcard[]) => {
    if (!activeLecture) return;
    setSaveError(null);
    const updated: LectureStudyKit = { ...activeLecture, flashcards };
    setActiveLecture(updated);
    if (user && savedLectureIds[activeLecture.id]) {
      void updateFlashcardsInCloud(user.uid, activeLecture.id, flashcards).catch((err) => {
        setSaveError(
          err instanceof Error ? `Could not sync flashcards: ${err.message}` : 'Could not sync flashcards.'
        );
      });
    }
  };

  const handleUpdateQuizProgress = (quizProgress: QuizProgress) => {
    if (!activeLecture) return;
    setSaveError(null);
    const updated: LectureStudyKit = { ...activeLecture, quizProgress };
    setActiveLecture(updated);
    if (user && savedLectureIds[activeLecture.id]) {
      void updateQuizProgressInCloud(user.uid, activeLecture.id, quizProgress).catch((err) => {
        setSaveError(
          err instanceof Error ? `Could not sync quiz score: ${err.message}` : 'Could not sync quiz score.'
        );
      });
    }
  };

  const handleSendChatMessage = async (question: string) => {
    if (!activeLecture) return;
    const currentMessages = isSavedToCloud ? cloudMessages : guestMessages;

    const res = await fetch('/api/lectures/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lectureTitle: activeLecture.title,
        transcriptSegments: activeLecture.transcriptSegments,
        history: currentMessages.map((m) => ({ role: m.role, content: m.content })),
        question,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Unable to answer question.');
    }

    if (user && savedLectureIds[activeLecture.id]) {
      await saveChatMessageToCloud(user.uid, activeLecture.id, {
        role: 'user',
        content: question,
        timestampRefs: [],
      });
      await saveChatMessageToCloud(user.uid, activeLecture.id, {
        role: 'assistant',
        content: data.answer,
        timestampRefs: data.timestampRefs || [],
      });
    } else {
      const now = Date.now();
      const userMsg: LectureChatMessage = {
        id: `local_u_${now}`,
        ownerId: 'guest',
        lectureId: activeLecture.id,
        role: 'user',
        content: question,
        timestampRefs: [],
      };
      const assistantMsg: LectureChatMessage = {
        id: `local_a_${now + 1}`,
        ownerId: 'guest',
        lectureId: activeLecture.id,
        role: 'assistant',
        content: data.answer,
        timestampRefs: data.timestampRefs || [],
      };
      setGuestMessages((prev) => [...prev, userMsg, assistantMsg]);
    }
  };

  const handleNewLecture = () => {
    setActiveLecture(null);
    setGuestMessages([]);
    setSaveError(null);
    setStage('idle');
    setIntakeError(null);
    setFallbackReason(null);
    setPendingVideoMeta(null);
    setYoutubeUrl('');
    setActiveView('workspace');
  };

  const handleOpenSavedLecture = (lecture: LectureStudyKit) => {
    setActiveLecture(lecture);
    setGuestMessages([]);
    setSaveError(null);
    setActiveView('workspace');
  };

  const handleDeleteSavedLecture = async (lectureId: string) => {
    if (!user) return;
    await deleteLectureFromCloud(user.uid, lectureId);
    if (activeLecture?.id === lectureId) {
      setActiveLecture(null);
      setSaveError(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col">
      <TopBar
        activeView={activeView}
        onNavigate={setActiveView}
        user={user}
        authReady={authReady}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        libraryCount={libraryLectures.length}
      />

      <main className="flex-1">
        {activeView === 'workspace' &&
          (activeLecture ? (
            <StudyWorkspace
              lecture={activeLecture}
              messages={isSavedToCloud ? cloudMessages : guestMessages}
              isSavedToCloud={isSavedToCloud}
              isSavingToCloud={isSavingToCloud}
              saveError={saveError}
              isSignedIn={Boolean(user)}
              onSaveToCloud={handleSaveToCloud}
              onNewLecture={handleNewLecture}
              onUpdateFlashcards={handleUpdateFlashcards}
              onUpdateQuizProgress={handleUpdateQuizProgress}
              onSendChatMessage={handleSendChatMessage}
            />
          ) : (
            <LectureIntakeHero
              stage={stage}
              youtubeUrl={youtubeUrl}
              onChangeUrl={setYoutubeUrl}
              onSubmitUrl={handleSubmitUrl}
              manualTranscriptText={manualTranscriptText}
              onChangeManualTranscript={setManualTranscriptText}
              onSubmitManualTranscript={handleSubmitManualTranscript}
              onCancelFallback={() => {
                setStage('idle');
                setPendingVideoMeta(null);
                setFallbackReason(null);
                setIntakeError(null);
              }}
              pendingVideoMeta={pendingVideoMeta}
              fallbackReason={fallbackReason}
              errorMessage={intakeError}
              onOpenManualMode={() => {
                setPendingVideoMeta(null);
                setFallbackReason(null);
                setIntakeError(null);
                setStage('needs_manual_transcript');
              }}
            />
          ))}

        {activeView === 'library' && (
          <StudyLibrary
            user={user}
            lectures={libraryLectures}
            loading={libraryLoading}
            onSignIn={handleSignIn}
            onOpenLecture={handleOpenSavedLecture}
            onDeleteLecture={handleDeleteSavedLecture}
            onCreateNew={handleNewLecture}
          />
        )}

        {activeView === 'guide' && (
          <HowItWorksView onStartWorkspace={() => setActiveView('workspace')} />
        )}
      </main>

      <footer className="no-print border-t border-slate-200 py-5 px-6 text-xs text-slate-500">
        <div className="max-w-[1380px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>LectureLens · YouTube Study Notes, Quiz, Flashcards &amp; Q&amp;A</span>
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={() => setActiveView('workspace')}
              className="hover:text-slate-900 transition-colors"
            >
              Workspace
            </button>
            <button
              type="button"
              onClick={() => setActiveView('library')}
              className="hover:text-slate-900 transition-colors"
            >
              Study Library
            </button>
            <button
              type="button"
              onClick={() => setActiveView('guide')}
              className="hover:text-slate-900 transition-colors"
            >
              How It Works
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LectureLensApp />
    </ErrorBoundary>
  );
}
