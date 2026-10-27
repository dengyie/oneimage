import { describe, expect, it } from 'vitest'
import { createEditorState, type EditorState } from '../src/domain/editor-state'
import {
  EMPTY_SESSION,
  addAnnotationLayer,
  canRedoSession,
  canUndoSession,
  commitDraft,
  commitVisibleState,
  discardDraft,
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

  it('commits a live gesture as one step whose undo returns to the state before it', () => {
    const { session, initial } = started()
    const cropped: EditorState = { ...initial, crop: { x: 10, y: 10, width: 50, height: 50 } }

    const dragging = liveEdit(session, cropped)
    expect(sessionState(dragging)).toBe(cropped)
    expect(canUndoSession(dragging)).toBe(false)

    const committed = commitDraft(dragging)
    expect(sessionState(committed)).toEqual(cropped)
    expect(committed.history?.past).toHaveLength(1)

    const undone = undoSession(committed)
    expect(sessionState(undone)).toEqual(initial)
    expect(sessionState(redoSession(undone))).toEqual(cropped)
  })

  it('treats a gesture that ends where it started as no edit at all', () => {
    const { session, initial } = started()
    // A slider sweep out and back is not an edit, so it must not create a step.
    const away = liveEdit(session, { ...initial, adjustments: { ...initial.adjustments, brightness: 15 } })
    const back = liveEdit(away, initial)
    const settled = commitDraft(back)

    expect(settled.history?.past).toHaveLength(0)
    expect(canUndoSession(settled)).toBe(false)
    expect(commitDraft(settled)).toBe(settled)
  })

  it('keeps the redo branch when a sweep returns to its starting value', () => {
    const { session, initial } = started()
    const rotated = commitVisibleState(session, { ...initial, rotation: 90 })
    const undone = undoSession(rotated)
    expect(canRedoSession(undone)).toBe(true)

    const away = liveEdit(undone, { ...initial, adjustments: { ...initial.adjustments, brightness: 15 } })
    const back = liveEdit(away, initial)
    const settled = commitDraft(back)

    // Nothing was committed, so the abandoned step is still reachable.
    expect(canRedoSession(settled)).toBe(true)
    expect(sessionState(redoSession(settled))).toEqual({ ...initial, rotation: 90 })
  })

  it('drops the redo branch when a discrete edit is recorded', () => {
    const { session, initial } = started()
    const rotated = commitVisibleState(session, { ...initial, rotation: 90 })
    const undone = undoSession(rotated)
    expect(canRedoSession(undone)).toBe(true)

    const diverged = commitVisibleState(undone, { ...initial, flipX: true })
    expect(canRedoSession(diverged)).toBe(false)
  })

  it('parks an uncommitted draft in the redo branch when undo runs', () => {
    const { session, initial } = started()
    const rotated = commitVisibleState(session, { ...initial, rotation: 90 })
    const draft: EditorState = { ...rotated.history!.present.state, flipY: true }

    const undone = undoSession(liveEdit(rotated, draft))
    expect(sessionState(undone)).toEqual(initial)
    // Redo brings back exactly what was on screen, draft included.
    expect(sessionState(redoSession(undone))).toEqual(draft)
  })

  it('adds an annotation on top of a live draft as one step', () => {
    const { session, initial } = started()
    const draft: EditorState = {
      ...initial,
      adjustments: { ...initial.adjustments, contrast: 30 },
    }
    const layer = { id: 'annot', type: 'rect' as const, rect: { x: 1, y: 2, width: 10, height: 10 }, color: '#fff', strokeWidth: 2 }

    const annotated = addAnnotationLayer(liveEdit(session, draft), layer)
    expect(annotated.history?.past).toHaveLength(1)
    expect(sessionState(annotated)).toEqual({ ...draft, annotations: [layer] })
    // The state the user was looking at is what undo restores.
    expect(sessionState(undoSession(annotated))).toEqual(draft)
  })

  it('adds annotations one at a time', () => {
    const { session, initial } = started()
    const first = { id: 'a', type: 'rect' as const, rect: { x: 0, y: 0, width: 5, height: 5 }, color: '#fff', strokeWidth: 1 }
    const second = { id: 'b', type: 'rect' as const, rect: { x: 6, y: 6, width: 5, height: 5 }, color: '#fff', strokeWidth: 1 }

    const one = addAnnotationLayer(session, first)
    const two = addAnnotationLayer(one, second)
    expect(sessionState(two)?.annotations).toEqual([first, second])
    expect(sessionState(undoSession(two))?.annotations).toEqual([first])
    expect(sessionState(undoSession(undoSession(two)))?.annotations ?? []).toEqual(initial.annotations)
  })

  it('ignores annotations and edits with no document open', () => {
    const layer = { id: 'a', type: 'rect' as const, rect: { x: 0, y: 0, width: 5, height: 5 }, color: '#fff', strokeWidth: 1 }
    expect(addAnnotationLayer(EMPTY_SESSION, layer)).toBe(EMPTY_SESSION)
    expect(commitVisibleState(EMPTY_SESSION, createEditorState(10, 10))).toBe(EMPTY_SESSION)
    expect(liveEdit(EMPTY_SESSION, createEditorState(10, 10))).toBe(EMPTY_SESSION)
    expect(discardDraft(EMPTY_SESSION)).toBe(EMPTY_SESSION)
  })

  it('discards an interrupted gesture without recording a step', () => {
    const { session, initial } = started()
    const dragging = liveEdit(session, { ...initial, crop: { x: 5, y: 5, width: 40, height: 40 } })

    const cancelled = discardDraft(dragging)
    expect(sessionState(cancelled)).toEqual(initial)
    expect(cancelled.draft).toBeNull()
    expect(cancelled.history).toBe(dragging.history)
    // Nothing to discard: the session is returned untouched.
    expect(discardDraft(cancelled)).toBe(cancelled)
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
    expect(commitDraft(session)).toBe(session)
  })
})
