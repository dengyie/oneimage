# OneImage Realtime Image Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-local, non-destructive image editor with live crop gestures, rotation, mirroring, global/local adjustments, history, preview rendering, and full-resolution export.

**Architecture:** Keep `EditorState` as pure serializable data in the domain layer. Use an application renderer to schedule preview/export work and cancellation, with a canvas infrastructure adapter for bitmap/filter operations. `ImageEditor` owns pointer interaction and controls; `App` only loads files, connects editor output to the existing download/provenance flow, and keeps current tool behavior available.

**Tech Stack:** React 19, TypeScript 7, Canvas 2D, Vitest 5, existing Vite build; no new runtime dependency.

## Global Constraints

- Preserve browser-local processing and the existing JPEG/PNG/WebP input policy with the 25 MB limit.
- Store all editor coordinates in source-image pixels; preview scaling is a renderer concern.
- Preserve original input and make every edit reversible through state history.
- Use `requestAnimationFrame` for continuous preview updates and abort stale renders.
- Do not add server routes, persistent storage, accounts, or image-upload behavior.
- Every production function added by this plan has a focused test written and observed failing first.

---

### Task 1: Editor State and Geometry Domain

**Files:**
- Create: `src/domain/editor-state.ts`
- Create: `tests/editor-state.test.ts`

**Interfaces:**
- Produces `Rect`, `Adjustments`, `LocalAdjustment`, `EditorState`, `DEFAULT_ADJUSTMENTS`, `createEditorState(width, height)`, `clampCrop(rect, bounds, aspectRatio)`, `rotateEditorState(state, quarterTurns)`, `pushHistory(history, state)`, `undoHistory(history)`, and `redoHistory(history)`.
- Consumes only primitive values and existing `LocalJob`-independent domain conventions.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { clampCrop, createEditorState, redoHistory, rotateEditorState, undoHistory, type EditorHistory } from '../src/domain/editor-state'

describe('editor state', () => {
  it('creates a full-image crop with neutral adjustments', () => {
    const state = createEditorState(1200, 800)
    expect(state.crop).toEqual({ x: 0, y: 0, width: 1200, height: 800 })
    expect(state.adjustments).toEqual({ brightness: 0, contrast: 0, saturation: 0, sharpen: 0, blur: 0 })
  })

  it('clamps a dragged crop to image bounds and fixed aspect ratio', () => {
    expect(clampCrop({ x: -20, y: 40, width: 1000, height: 1000 }, { x: 0, y: 0, width: 800, height: 600 }, 1)).toEqual({ x: 0, y: 0, width: 600, height: 600 })
  })

  it('rotates geometry and swaps dimensions for quarter turns', () => {
    const state = createEditorState(1200, 800)
    const rotated = rotateEditorState(state, 1)
    expect(rotated.rotation).toBe(90)
    expect(rotated.crop).toEqual({ x: 0, y: 0, width: 800, height: 1200 })
  })

  it('undoes and redoes immutable state snapshots', () => {
    const first = createEditorState(100, 100)
    const second = { ...first, rotation: 90 }
    const history: EditorHistory = { past: [first], present: second, future: [] }
    expect(undoHistory(history).present).toBe(first)
    expect(redoHistory(undoHistory(history)).present).toBe(second)
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run tests/editor-state.test.ts`
Expected: FAIL because `src/domain/editor-state.ts` does not exist.

- [ ] **Step 3: Implement the minimal pure domain functions**

Implement `clampCrop` with guard clauses: normalize positive width/height, apply aspect ratio by shrinking the longer dimension around the crop center, clamp width/height to bounds, then clamp `x/y`. `rotateEditorState` must swap crop width/height and the source bounds on odd quarter turns, normalize rotation to `[0, 360)`, and preserve adjustments/local regions. History functions must return new objects and clear `future` whenever a new state is pushed.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- --run tests/editor-state.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain/editor-state.ts tests/editor-state.test.ts
git commit -m "feat: add non-destructive editor state model"
```

### Task 2: Preview and Export Renderer

**Files:**
- Create: `src/application/editor-renderer.ts`
- Create: `src/infrastructure/editor-canvas.ts`
- Create: `tests/editor-renderer.test.ts`

**Interfaces:**
- `decodeSource(file: Blob, signal?: AbortSignal): Promise<DecodedSource>` where `DecodedSource` exposes width, height, and a `draw(ctx, width, height)` method plus `close()`.
- `renderEditor(source: DecodedSource, state: EditorState, options: { maxEdge?: number; signal?: AbortSignal }): Promise<RenderedImage>` where `RenderedImage` contains a Canvas or OffscreenCanvas and dimensions.
- `exportEditor(source: DecodedSource, state: EditorState, options: { mime: string; quality: number; signal?: AbortSignal }): Promise<Blob>`.
- `schedulePreview(task: () => Promise<void>): () => void` coalesces calls with `requestAnimationFrame` and cancels the pending frame.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { createEditorState } from '../src/domain/editor-state'
import { renderEditor, schedulePreview } from '../src/application/editor-renderer'

describe('editor renderer', () => {
  it('keeps preview bounded while export keeps source dimensions', async () => {
    const source = { width: 4000, height: 3000, draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => { ctx.fillRect(0, 0, width, height) }, close: () => {} }
    const state = createEditorState(4000, 3000)
    const preview = await renderEditor(source, state, { maxEdge: 1600 })
    const exportImage = await renderEditor(source, state, { maxEdge: Number.POSITIVE_INFINITY })
    expect(Math.max(preview.width, preview.height)).toBe(1600)
    expect([exportImage.width, exportImage.height]).toEqual([4000, 3000])
  })

  it('cancels a pending animation frame when replaced', async () => {
    const calls: string[] = []
    const cancel = schedulePreview(async () => { calls.push('render') })
    cancel()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([])
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run tests/editor-renderer.test.ts`
Expected: FAIL because renderer modules do not exist.

- [ ] **Step 3: Implement the canvas adapter and renderer**

Use `createImageBitmap` when available and an `HTMLImageElement` fallback for browser compatibility. Create a preview canvas sized by `maxEdge`; export uses source dimensions. Apply crop, rotation, flips, CSS-like global filters, and local rectangular masks in the fixed order from the design. Implement sharpen as a small convolution only when `sharpen > 0`; avoid allocating full-size temporary canvases for each local region by clipping the target context and applying the region’s filter in place. Check `signal.aborted` between decode, geometry, filter, and blob stages and throw `DOMException('aborted', 'AbortError')`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- --run tests/editor-renderer.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/application/editor-renderer.ts src/infrastructure/editor-canvas.ts tests/editor-renderer.test.ts
git commit -m "feat: add live preview and full-resolution editor renderer"
```

### Task 3: Editor Canvas Interaction Component

**Files:**
- Create: `src/components/ImageEditor.tsx`
- Modify: `src/styles.css`
- Create: `tests/image-editor-model.test.ts`

**Interfaces:**
- `ImageEditorProps = { file: File; outputMime: string; quality: number; onExport: (blob: Blob, filename: string) => void; onChange?: (state: EditorState) => void }`.
- Component consumes `decodeSource`, `renderEditor`, `exportEditor`, and domain history functions.
- Component produces accessible controls and `onExport` output without uploading the source.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { createCropGesture, mapPointerToSource, updateCropGesture } from '../src/components/image-editor-model'

describe('image editor interaction model', () => {
  it('keeps crop movement bounded and maps rotated pointers', () => {
    const gesture = createCropGesture('move', { x: 100, y: 100 }, { x: 0, y: 0, width: 400, height: 300 }, { x: 0, y: 0, width: 800, height: 600 })
    expect(updateCropGesture(gesture, { x: 700, y: 500 })).toEqual({ x: 400, y: 300, width: 400, height: 300 })
    expect(mapPointerToSource({ x: 150, y: 50 }, { width: 200, height: 300 }, 90, false, false)).toEqual({ x: 50, y: 150 })
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run tests/image-editor-model.test.ts`
Expected: FAIL because the interaction model does not exist.

- [ ] **Step 3: Implement the component and styles**

Create a stable canvas wrapper with an absolutely positioned crop overlay. Use pointer capture for move/resize modes, convert client coordinates into source coordinates, call `clampCrop`, and update history only on gesture completion. Use controlled range inputs for global and selected-local adjustments. Use `useEffect` cleanup to abort decode/render tasks, cancel animation frames, close decoded sources, and revoke generated object URLs. Keep controls keyboard accessible with explicit labels and disabled states.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- --run tests/image-editor-model.test.ts`
Expected: the interaction model tests pass without network requests; DOM controls are checked with the browser QA task.

- [ ] **Step 5: Commit**

```bash
git add src/components/ImageEditor.tsx src/components/image-editor-model.ts src/styles.css tests/image-editor-model.test.ts
git commit -m "feat: add interactive editor canvas controls"
```

### Task 4: App Integration and Existing Workflow Preservation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `tests/image-ops.test.ts` or create `tests/app-editor-integration.test.tsx` if the existing test environment can render React.

**Interfaces:**
- `App` passes the selected source file and export settings to `ImageEditor`.
- Existing tool registry, local-tool runner, download link, provenance action, and cancellation remain available.

- [ ] **Step 1: Write the failing integration test**

Assert that selecting an accepted image renders the editor workspace, changing output MIME reaches the editor, and provenance remains a separate explicit action. Assert that existing tool buttons remain present and no fetch occurs during local editing.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- --run tests/app-editor-integration.test.tsx`
Expected: FAIL because `App` still renders the old dropzone/settings flow.

- [ ] **Step 3: Replace the old single-run surface with editor-first composition**

Keep file validation and object URL lifecycle in `App`, render `ImageEditor` whenever `file` exists, keep the tool rail and provenance card, and retain the old local-tool runner behind an “advanced tool” action for non-editor operations such as convert/compress/watermark. Route editor export into the existing result URL/name state and download link. Reset editor state when a new file is selected.

- [ ] **Step 4: Run the full local verification**

Run: `npm test && npx tsc --noEmit && npm run build && npm run server:build`
Expected: all existing tests plus editor tests pass; frontend and server builds exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/styles.css tests
git commit -m "feat: integrate realtime image editing into workspace"
```

### Task 5: Browser QA, Documentation, and Release Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-17-realtime-image-editor-design.md` if acceptance clarifications are needed.
- Modify: `01.项目/OneImage/OneImage 开发文档.md` in the Obsidian vault.
- Modify: `01.项目/OneImage/OneImage 文档索引.md` and `00.MOC/AI-DOC-ROUTER.md` only for the final current-state entry.
- Modify: `.codex-memory/project-state.md`, `.codex-memory/todo.md`, `.codex-memory/session-log.md`, `.codex-memory/decisions.md`.

- [ ] **Step 1: Run the dev server and inspect the real browser workflow**

Run: `npm run dev -- --host 127.0.0.1 --port 5174`
Expected: the app responds on `http://127.0.0.1:5174`; manually verify file load, crop drag/resize, touch pointer events through emulation, rotation/mirror, global/local sliders, undo/redo/reset, preview refresh, and export download.

- [ ] **Step 2: Run regression checks**

Run: `npm test && npx tsc --noEmit && npm run build && npm run server:build`
Expected: zero test failures and zero build/type errors.

- [ ] **Step 3: Update canonical documentation and memory**

Record the new editor-first flow, coordinate model, preview/export distinction, and remaining performance limits in the canonical OneImage development document. Run `python .local/bin/scan-stale-docs --vault .` from the Obsidian vault and require `RESULT=OK`.

- [ ] **Step 4: Commit and deploy only after verification**

```bash
git add docs .codex-memory
git commit -m "docs: record realtime editor architecture and verification"
git push origin main
```

Expected: GitHub Actions verify/package/deploy-pxed succeeds; after deployment re-check `/healthz`, `/api/v1/capabilities`, and one provenance request because the server bundle is included in the release.
