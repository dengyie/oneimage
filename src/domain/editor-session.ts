import { editorStatesEqual, type EditorState, type HistoryTree } from './editor-state'

/**
 * A history entry is a whole document, not just its parameters: restoring a
 * draft from the history drawer replaces the decoded image as well, so undo has
 * to be able to bring the previous image back.
 */
export interface EditorSnapshot {
  /** Stable per-document id; also the IndexedDB draft id for restored drafts. */
  docId: string
  file: File
  state: EditorState
}

/**
 * `history` only ever holds committed snapshots. Live gesture output (a crop
 * drag, a slider sweep) lives in `draft` until the gesture ends, so committing
 * can push the state the user started from instead of the state they ended on.
 */
export interface EditorSession {
  history: HistoryTree<EditorSnapshot> | null
  draft: EditorState | null
}

export const EMPTY_SESSION: EditorSession = { history: null, draft: null }

export function sessionState(session: EditorSession): EditorState | null {
  return session.draft ?? session.history?.present.state ?? null
}

export function sessionSnapshot(session: EditorSession): EditorSnapshot | null {
  return session.history?.present ?? null
}

export function canUndoSession(session: EditorSession): boolean {
  return (session.history?.past.length ?? 0) > 0
}

export function canRedoSession(session: EditorSession): boolean {
  return (session.history?.future.length ?? 0) > 0
}

/** What the user is currently looking at, draft included. */
function visibleSnapshot(session: EditorSession): EditorSnapshot | null {
  const present = session.history?.present
  if (!present) return null
  return session.draft ? { ...present, state: session.draft } : present
}

/** Live gesture output: shown immediately, not yet an undoable step. */
export function liveEdit(session: EditorSession, next: EditorState): EditorSession {
  if (!session.history) return session
  const visible = sessionState(session)
  if (visible && editorStatesEqual(visible, next)) return session
  // Editing after an undo abandons the redo branch.
  return { history: { ...session.history, future: [] }, draft: next }
}

/**
 * Records an edit whose final state is already visible. The pushed past entry
 * is the last committed state, which is what undo must return to.
 */
export function commitState(session: EditorSession, next: EditorState): EditorSession {
  const present = session.history?.present
  if (!present) return session
  if (editorStatesEqual(present.state, next)) {
    // A commit that carries nothing new. A live draft that differs from it is
    // still uncommitted work — a stale caller must not destroy it.
    if (session.draft && !editorStatesEqual(session.draft, next)) return session
    return { history: session.history, draft: null }
  }
  return {
    history: { past: [...(session.history?.past ?? []), present], present: { ...present, state: next }, future: [] },
    draft: null,
  }
}

/** Commits whatever the live gesture produced (crop drag, slider sweep). */
export function commitDraft(session: EditorSession): EditorSession {
  return session.draft ? commitState(session, session.draft) : session
}

/**
 * Records a discrete action. Unlike a gesture, an uncommitted draft is part of
 * the state the user was looking at, so undo restores the draft too.
 */
export function commitVisibleState(session: EditorSession, next: EditorState): EditorSession {
  const visible = visibleSnapshot(session)
  if (!visible) return session
  if (editorStatesEqual(visible.state, next)) return { history: session.history, draft: null }
  return {
    history: { past: [...(session.history?.past ?? []), visible], present: { ...visible, state: next }, future: [] },
    draft: null,
  }
}

export function undoSession(session: EditorSession): EditorSession {
  const history = session.history
  const visible = visibleSnapshot(session)
  if (!history || !visible || history.past.length === 0) return session
  const target = history.past[history.past.length - 1]
  return {
    history: { past: history.past.slice(0, -1), present: target, future: [visible, ...history.future] },
    draft: null,
  }
}

export function redoSession(session: EditorSession): EditorSession {
  const history = session.history
  const visible = visibleSnapshot(session)
  if (!history || !visible || history.future.length === 0) return session
  const target = history.future[0]
  return {
    history: { past: [...history.past, visible], present: target, future: history.future.slice(1) },
    draft: null,
  }
}

/**
 * Opens a document (new image, or a draft restored from history). The document
 * being replaced stays in the tree, so undo switches back to it.
 */
export function openDocument(session: EditorSession, snapshot: EditorSnapshot): EditorSession {
  const visible = visibleSnapshot(session)
  if (!visible) return { history: { past: [], present: snapshot, future: [] }, draft: null }
  return {
    history: { past: [...(session.history?.past ?? []), visible], present: snapshot, future: [] },
    draft: null,
  }
}
