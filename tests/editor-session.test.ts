import { describe, expect, it } from 'vitest'
import { createEditorState, type EditorState } from '../src/domain/editor-state'
import {
  EMPTY_SESSION,
  canRedoSession,
  canUndoSession,
  commitDraft,
  commitState,
  commitVisibleState,
  liveEdit,
  openDocument,
  redoSession,
  sessionState,
  undoSession,
  type EditorSession,
  type EditorSnapshot,
} from '../src/domain/editor-session'

function snapshot(docId: string, state: EditorState): EditorSnapshot {
  return { docId, file: new File([new Uint8Array([0])], `${docId}.png`, { type: 'image/png' }), state }
}

function started(docId = 'doc-a'): { session: EditorSession; initial: EditorState } {
  const initial = createEditorState(100, 100)
  return { session: openDocument(EMPTY_SESSION, snapshot(docId, initial)), initial }
}

describe('editor session history', () => {
  it('starts a tree with no undoable step', () => {
    const { session, initial } = started()
    expect(sessionState(session)).toBe(initial)
    expect(canUndoSession(session)).toBe(false)
    expect(canRedoSession(session)).toBe(false)
  })

  it('records the state a committed gesture started from, so undo changes the image', () => {
    // A crop drag writes live states first, then commits its final result.
    const { session, initial } = started()
    const cropped: EditorState = { ...initial, crop: { x: 10, y: 10, width: 50, height: 50 } }
    const live = liveEdit(session, cropped)
    expect(sessionState(live)).toBe(cropped)

    const committed = commitState(live, cropped)
    expect(sessionState(committed)).toEqual(cropped)
    expect(canUndoSession(committed)).toBe(true)

    const undone = undoSession(committed)
    expect(sessionState(undone)).toEqual(initial)
    expect(canRedoSession(undone)).toBe(true)

    const redone = redoSession(undone)
    expect(sessionState(redone)).toEqual(cropped)
  })

  it('commits a live draft without duplicating it into the past', () => {
    const { session, initial } = started()
    const brightened: EditorState = {
      ...initial,
      adjustments: { ...initial.adjustments, brightness: 20 },
    }
    const afterSweep = commitDraft(liveEdit(session, brightened))
    expect(sessionState(afterSweep)).toEqual(brightened)
    expect(afterSweep.history?.past).toHaveLength(1)

    const undone = undoSession(afterSweep)
    expect(sessionState(undone)).toEqual(initial)
  })

  it('ignores a commit that matches the committed state', () => {
    const { session, initial } = started()
    const committed = commitDraft(liveEdit(session, { ...initial, rotation: 90 }))
    const noop = commitDraft(liveEdit(committed, { ...committed.history!.present.state }))
    expect(noop.history?.past).toHaveLength(1)
    expect(commitState(committed, { ...committed.history!.present.state }).history).toBe(committed.history)
  })

  it('never lets a stale commit discard a live draft', () => {
    const { session, initial } = started()
    const draft: EditorState = { ...initial, crop: { x: 5, y: 5, width: 40, height: 40 } }
    const dragging = liveEdit(session, draft)

    // A caller that passes the pre-drag state (a render-time snapshot that has
    // not caught up yet) must not wipe the drag the user is making.
    expect(commitState(dragging, initial)).toBe(dragging)
    expect(sessionState(commitState(dragging, initial))).toEqual(draft)

    // Committing the draft itself still records exactly one step.
    const committed = commitDraft(dragging)
    expect(committed.history?.past).toHaveLength(1)
    expect(sessionState(undoSession(committed))).toEqual(initial)
  })

  it('commits a crop drag that only exists as a draft', () => {
    const { session, initial } = started()
    const cropped: EditorState = { ...initial, crop: { x: 0, y: 0, width: 80, height: 80 } }
    const committed = commitDraft(liveEdit(session, cropped))
    expect(sessionState(committed)).toEqual(cropped)
    expect(sessionState(undoSession(committed))).toEqual(initial)
    expect(commitDraft(committed)).toBe(committed)
  })

  it('drops the redo branch when a new edit happens after undo', () => {
    const { session, initial } = started()
    const rotated = commitVisibleState(session, { ...initial, rotation: 90 })
    const undone = undoSession(rotated)
    expect(canRedoSession(undone)).toBe(true)

    const diverged = liveEdit(undone, { ...initial, flipX: true })
    expect(canRedoSession(diverged)).toBe(false)
  })

  it('undoes a reset back to the edited state', () => {
    const { session, initial } = started()
    const edited = commitVisibleState(session, { ...initial, rotation: 90, flipY: true })
    const reset = commitVisibleState(edited, createEditorState(100, 100))
    expect(sessionState(reset)).toEqual(createEditorState(100, 100))

    const undone = undoSession(reset)
    expect(sessionState(undone)).toEqual({ ...initial, rotation: 90, flipY: true })
    // the reset itself stays redoable
    expect(sessionState(redoSession(undone))).toEqual(createEditorState(100, 100))
  })

  it('keeps an uncommitted draft restorable through undo of a reset', () => {
    const { session, initial } = started()
    const draft: EditorState = { ...initial, adjustments: { ...initial.adjustments, contrast: 30 } }
    const withDraft = liveEdit(session, draft)
    const reset = commitVisibleState(withDraft, createEditorState(100, 100))
    expect(sessionState(undoSession(reset))).toEqual(draft)
  })

  it('restoring another draft joins the tree, and undo returns to the previous document', () => {
    const { session } = started('doc-a')
    const restoredState: EditorState = { ...createEditorState(80, 60), rotation: 180 }
    const restored = openDocument(session, snapshot('doc-b', restoredState))

    expect(restored.history?.present.docId).toBe('doc-b')
    expect(sessionState(restored)).toEqual(restoredState)

    const undone = undoSession(restored)
    expect(undone.history?.present.docId).toBe('doc-a')
    expect(sessionState(undone)).toEqual(createEditorState(100, 100))

    const redone = redoSession(undone)
    expect(redone.history?.present.docId).toBe('doc-b')
    expect(sessionState(redone)).toEqual(restoredState)
  })

  it('replacing the image keeps the previous document undoable', () => {
    const { session, initial } = started('doc-a')
    const edited = commitVisibleState(session, { ...initial, flipX: true })
    const replaced = openDocument(edited, snapshot('doc-b', createEditorState(50, 50)))

    expect(sessionState(undoSession(replaced))).toEqual({ ...initial, flipX: true })
    expect(undoSession(replaced).history?.present.docId).toBe('doc-a')
  })

  it('carries an uncommitted draft across a document switch', () => {
    const { session, initial } = started('doc-a')
    const draft: EditorState = { ...initial, rotation: 270 }
    const switched = openDocument(liveEdit(session, draft), snapshot('doc-b', createEditorState(50, 50)))
    expect(sessionState(undoSession(switched))).toEqual(draft)
  })

  it('does nothing when there is nowhere to go', () => {
    const { session } = started()
    expect(undoSession(session)).toBe(session)
    expect(redoSession(session)).toBe(session)
    expect(commitState(EMPTY_SESSION, createEditorState(10, 10))).toBe(EMPTY_SESSION)
  })
})
