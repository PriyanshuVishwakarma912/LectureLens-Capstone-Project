import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, type User } from './firebase';
import { handleFirestoreError, OperationType } from './firestoreError';
import {
  BLUEPRINT_LIMITS,
  type Flashcard,
  type LectureChatMessage,
  type LectureStudyKit,
  type QuizProgress,
} from '../types/lecture';

function generateSafeId(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, BLUEPRINT_LIMITS.ID_MAX);
}

function toEpochMs(ts: unknown): number {
  if (!ts) return 0;
  if (ts instanceof Timestamp) return ts.toMillis();
  if (typeof ts === 'object' && ts !== null && 'seconds' in ts) {
    return Number((ts as { seconds: number }).seconds) * 1000;
  }
  if (typeof ts === 'number') return ts;
  return 0;
}

function downsampleItems<T>(items: T[], maxCount: number): T[] {
  if (items.length <= maxCount) return items;
  if (maxCount <= 0) return [];
  if (maxCount === 1) return [items[0]];
  const result: T[] = [];
  const step = (items.length - 1) / (maxCount - 1);
  for (let i = 0; i < maxCount; i++) {
    result.push(items[Math.round(i * step)]);
  }
  return result;
}

function estimatePayloadBytes(obj: unknown): number {
  const json = JSON.stringify(obj);
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length;
}

function sanitizeLecturePayload(
  userId: string,
  lectureId: string,
  input: Omit<LectureStudyKit, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
) {
  const safeDuration =
    typeof input.durationSec === 'number' && Number.isFinite(input.durationSec) && input.durationSec >= 0
      ? Math.min(BLUEPRINT_LIMITS.DURATION_MAX, Math.floor(input.durationSec))
      : undefined;

  let transcriptSegments = downsampleItems(input.transcriptSegments, BLUEPRINT_LIMITS.SEGMENTS_MAX).map((s) => ({
    startSec: Math.max(0, Math.floor(s.startSec)),
    text: String(s.text || '').slice(0, 1000),
  }));

  const payload = {
    id: lectureId,
    ownerId: userId,
    videoId: (input.videoId || 'manual').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, BLUEPRINT_LIMITS.VIDEO_ID_MAX) || 'manual',
    youtubeUrl: (input.youtubeUrl || 'manual').slice(0, BLUEPRINT_LIMITS.URL_MAX),
    title: (input.title || 'Untitled Lecture').slice(0, BLUEPRINT_LIMITS.TITLE_MAX),
    channelName: (input.channelName || 'Independent Lecture').slice(0, BLUEPRINT_LIMITS.CHANNEL_MAX),
    thumbnailUrl: (input.thumbnailUrl || '').slice(0, BLUEPRINT_LIMITS.URL_MAX),
    sourceType: input.sourceType,
    ...(safeDuration !== undefined ? { durationSec: safeDuration } : {}),
    transcriptSegments,
    studyNotes: {
      executiveSummary: input.studyNotes.executiveSummary.slice(0, BLUEPRINT_LIMITS.SUMMARY_MAX),
      keyTakeaways: input.studyNotes.keyTakeaways
        .slice(0, BLUEPRINT_LIMITS.TAKEAWAYS_MAX)
        .map((t) => String(t).slice(0, 600)),
      sections: input.studyNotes.sections.slice(0, BLUEPRINT_LIMITS.SECTIONS_MAX).map((sec) => ({
        heading: String(sec.heading || 'Topic Section').slice(0, 200),
        timestampSec: Math.max(0, Math.floor(Number(sec.timestampSec) || 0)),
        summary: String(sec.summary || '').slice(0, BLUEPRINT_LIMITS.SECTION_SUMMARY_MAX),
        bulletPoints: (sec.bulletPoints || [])
          .slice(0, BLUEPRINT_LIMITS.SECTION_BULLETS_MAX)
          .map((b) => String(b).slice(0, 600)),
      })),
      glossary: input.studyNotes.glossary.slice(0, BLUEPRINT_LIMITS.GLOSSARY_MAX).map((g) => ({
        term: String(g.term || '').slice(0, 120),
        definition: String(g.definition || '').slice(0, 600),
      })),
    },
    flashcards: input.flashcards.slice(0, BLUEPRINT_LIMITS.FLASHCARDS_MAX),
    quizQuestions: input.quizQuestions.slice(0, BLUEPRINT_LIMITS.QUIZ_MAX),
    quizProgress: {
      selectedAnswers: input.quizProgress.selectedAnswers.slice(0, BLUEPRINT_LIMITS.QUIZ_MAX),
      lastScore: Math.max(0, Math.floor(input.quizProgress.lastScore)),
      bestScore: Math.max(0, Math.floor(input.quizProgress.bestScore)),
      totalQuestions: Math.max(1, Math.floor(input.quizProgress.totalQuestions)),
      attemptCount: Math.max(0, Math.floor(input.quizProgress.attemptCount)),
    },
  };

  // Guarantee total Firestore document size remains safely below the 1,048,576-byte cap
  const MAX_SAFE_BYTES = 840_000;
  if (estimatePayloadBytes(payload) > MAX_SAFE_BYTES && payload.transcriptSegments.length > 80) {
    let cap = Math.floor(payload.transcriptSegments.length * 0.65);
    while (cap >= 60 && estimatePayloadBytes(payload) > MAX_SAFE_BYTES) {
      transcriptSegments = downsampleItems(transcriptSegments, cap);
      payload.transcriptSegments = transcriptSegments;
      cap = Math.floor(cap * 0.7);
    }
  }
  if (estimatePayloadBytes(payload) > MAX_SAFE_BYTES) {
    payload.transcriptSegments = payload.transcriptSegments.map((s) => ({
      startSec: s.startSec,
      text: s.text.slice(0, 450),
    }));
  }

  return payload;
}

export async function upsertUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const email = (user.email || `${user.uid}@lecturelens.app`).slice(0, 320);
  const displayName = (user.displayName || email.split('@')[0] || 'Learner').slice(0, 120);
  const photoURL = user.photoURL ? user.photoURL.slice(0, 500) : undefined;

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email,
        displayName,
        ...(photoURL ? { photoURL } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        email,
        displayName,
        ...(photoURL ? { photoURL } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveLectureToCloud(
  userId: string,
  lecture: Omit<LectureStudyKit, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>,
  existingId?: string
): Promise<LectureStudyKit> {
  const lectureId = existingId && BLUEPRINT_LIMITS.ID_PATTERN.test(existingId) ? existingId : generateSafeId('lec');
  const path = `users/${userId}/lectures/${lectureId}`;
  const ref = doc(db, 'users', userId, 'lectures', lectureId);
  const payload = sanitizeLecturePayload(userId, lectureId, lecture);

  try {
    await setDoc(ref, {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return {
      ...payload,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeUserLectures(
  userId: string,
  onData: (lectures: LectureStudyKit[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/lectures`;
  const q = query(collection(db, 'users', userId, 'lectures'), where('ownerId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as LectureStudyKit);
      items.sort((a, b) => toEpochMs(b.updatedAt) - toEpochMs(a.updatedAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function updateFlashcardsInCloud(
  userId: string,
  lectureId: string,
  flashcards: Flashcard[]
): Promise<void> {
  const path = `users/${userId}/lectures/${lectureId}`;
  const ref = doc(db, 'users', userId, 'lectures', lectureId);
  try {
    await updateDoc(ref, {
      flashcards: flashcards.slice(0, BLUEPRINT_LIMITS.FLASHCARDS_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateQuizProgressInCloud(
  userId: string,
  lectureId: string,
  quizProgress: QuizProgress
): Promise<void> {
  const path = `users/${userId}/lectures/${lectureId}`;
  const ref = doc(db, 'users', userId, 'lectures', lectureId);
  try {
    await updateDoc(ref, {
      quizProgress: {
        selectedAnswers: quizProgress.selectedAnswers.slice(0, BLUEPRINT_LIMITS.QUIZ_MAX),
        lastScore: Math.max(0, Math.floor(quizProgress.lastScore)),
        bestScore: Math.max(0, Math.floor(quizProgress.bestScore)),
        totalQuestions: Math.max(1, Math.floor(quizProgress.totalQuestions)),
        attemptCount: Math.max(0, Math.floor(quizProgress.attemptCount)),
        lastAttemptAt: serverTimestamp(),
      },
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteLectureFromCloud(userId: string, lectureId: string): Promise<void> {
  const path = `users/${userId}/lectures/${lectureId}`;
  const ref = doc(db, 'users', userId, 'lectures', lectureId);
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeLectureMessages(
  userId: string,
  lectureId: string,
  onData: (messages: LectureChatMessage[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${userId}/lectures/${lectureId}/messages`;
  const q = query(
    collection(db, 'users', userId, 'lectures', lectureId, 'messages'),
    where('ownerId', '==', userId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as LectureChatMessage);
      items.sort((a, b) => toEpochMs(a.createdAt) - toEpochMs(b.createdAt));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function saveChatMessageToCloud(
  userId: string,
  lectureId: string,
  message: Pick<LectureChatMessage, 'role' | 'content' | 'timestampRefs'>
): Promise<void> {
  const messageId = generateSafeId('msg');
  const path = `users/${userId}/lectures/${lectureId}/messages/${messageId}`;
  const ref = doc(db, 'users', userId, 'lectures', lectureId, 'messages', messageId);

  try {
    await setDoc(ref, {
      id: messageId,
      ownerId: userId,
      lectureId,
      role: message.role,
      content: message.content.slice(0, BLUEPRINT_LIMITS.CHAT_CONTENT_MAX),
      timestampRefs: message.timestampRefs.slice(0, BLUEPRINT_LIMITS.CHAT_REFS_MAX),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}
