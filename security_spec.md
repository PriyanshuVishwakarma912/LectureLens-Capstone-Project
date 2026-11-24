# LectureLens Firestore Security Specification

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every `/users/{userId}` document, `/users/{userId}/lectures/{lectureId}` study kit, and `/users/{userId}/lectures/{lectureId}/messages/{messageId}` message belongs exclusively to `userId === request.auth.uid` with `email_verified == true`.
2. **Path-Payload Binding**: Document IDs (`userId`, `lectureId`, `messageId`) must match `^[a-zA-Z0-9_-]+$` (`<= 128` chars), and payload `uid`/`id`/`ownerId`/`lectureId` fields must strictly match their path parameters.
3. **Temporal & Field Immutability**: `createdAt` must equal `request.time` on creation and never change; `updatedAt` must equal `request.time` on every mutation; `ownerId`, `id`, and `videoId` are immutable after creation.
4. **Master Gate for Subcollections**: Creating or reading a chat message under `lectures/{lectureId}/messages/{messageId}` verifies that the parent `lectures/{lectureId}` exists and is owned by `request.auth.uid`.
5. **Bounded Payloads**: All strings and arrays have strict upper size limits (`transcriptSegments <= 800`, `executiveSummary <= 12000`, `keyTakeaways <= 40`, `sections <= 100`, `glossary <= 100`, `flashcards <= 60`, `quizQuestions <= 30`, `timestampRefs <= 12`).

## 2. Adversarial Test Payloads ("Dirty Dozen")
1. **Unauthenticated Lecture Create**: Missing `request.auth` -> `PERMISSION_DENIED`.
2. **Unverified Email Write**: `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
3. **Cross-User Profile Read (PII Leak)**: User B reads `/users/userA` -> `PERMISSION_DENIED`.
4. **Cross-User Lecture List (Query Trust Bypass)**: User B lists `/users/userA/lectures` -> `PERMISSION_DENIED`.
5. **Identity Spoofing on Create**: User A creates `/users/userA/lectures/lec1` with `ownerId: "userB"` -> `PERMISSION_DENIED`.
6. **Shadow Ghost Field Injection**: User A creates lecture with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
7. **ID Poisoning Attack**: User A creates `/users/userA/lectures/bad$path..` or 200-char ID -> `PERMISSION_DENIED`.
8. **Immutable Field Tampering**: User A updates `lecture.videoId` or `lecture.createdAt` -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: User A creates lecture with backdated `createdAt` (`!= request.time`) -> `PERMISSION_DENIED`.
10. **Array Exhaustion ("Denial of Wallet")**: User A creates lecture with 801 `transcriptSegments`, 101 `sections`, or 61 `flashcards` -> `PERMISSION_DENIED`.
11. **Orphaned Chat Message**: User A creates message under nonexistent `lectureId` -> `PERMISSION_DENIED`.
12. **Message Mutation / Tampering**: User A updates an existing message under `messages/{messageId}` -> `PERMISSION_DENIED`.
