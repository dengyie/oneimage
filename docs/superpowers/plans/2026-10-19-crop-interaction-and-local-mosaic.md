# Crop Interaction and Local Mosaic Implementation Plan

> **For agentic workers:** This plan is executed inline in the current session. Keep each task test-first and verify the production workflow before deployment claims.

**Goal:** Make crop resizing/movement usable on mouse and touch, and add a local adjustable pixelation region rendered consistently in preview and full-resolution export.

**Architecture:** Keep geometry and serializable mosaic settings in `EditorState`; retain the current source-coordinate pointer model and local-region geometry. Render mosaic from the already globally/local-filtered image through a downscaled scratch canvas, then clip and composite it in the existing preview/export renderer.

**Tech Stack:** React 19, TypeScript, Canvas 2D/OffscreenCanvas, Vitest, Playwright, GitHub Actions deployment.

## Global Constraints

- Initial crop stays equal to full source bounds and export remains a no-op until crop parameters change.
- Source image remains local; do not add image-processing dependencies.
- Use one renderer for preview and export, and keep mosaic inside its selected rectangular local region.
- Keep crop movement/resizing bounded by source dimensions and respect selected aspect ratio.
- Deploy only through the repository's GitHub Actions pipeline.

---

### Task 1: Prove and fix crop pointer interaction

**Files:** `src/components/ImageEditor.tsx`, `src/styles.css`, `tests/image-editor-model.test.ts`, browser repro.

- [x] Reproduce on production: drag southeast resize handle and crop move area; the full-image frame does not respond until the lower handle is brought into view. A separate scrolled-into-view repro confirms geometry changes.
- [x] Add a sequential bounded move test after shrinking the full-image selection.
- [x] Add an explicit crop entry that centers an 82% selection, increase hit targets to 32×32px while keeping 12px markers, capture gestures on the surface, and explain shrink-before-move.
- [x] Verify desktop resize/move and Chromium native touch resizing change crop geometry; mobile hit target is 32×32px and the 390px viewport has no horizontal overflow.

### Task 2: Add local mosaic state and rendering

**Files:** `src/domain/editor-state.ts`, `src/application/editor-renderer.ts`, `tests/editor-renderer.test.ts`.

- [x] Add optional `mosaicBlockSize` to `LocalAdjustment`; absent or zero means disabled, and renderer clamps the effective size.
- [x] Add a renderer regression for block-sized scratch surfaces and clockwise transformed mask paths. The new scratch-surface test failed before implementation.
- [x] Implement a region-sized downscaled canvas and nearest-neighbor upscale clipped to the clockwise transformed local region.
- [x] Verify real preview and PNG export pixels contain uniform 8×8 samples inside a 16px mosaic block and preserve pixels outside the mask.

### Task 3: Expose local mosaic controls

**Files:** `src/components/ImageEditor.tsx`, `src/styles.css`, browser UI regression.

- [x] Add “打码区域” creation centered within the current crop and store it in editor history.
- [x] Show a pixel-block-size slider for selected regions and initialize new mosaic regions with a visible effect.
- [x] Verify region creation, block-size adjustment, undo/redo, reset and global-control recovery; moving uses the same bounded local-region pointer gesture.

### Task 4: Release and online verification

**Files:** `.codex-memory/project-state.md`, `.codex-memory/todo.md`, `.codex-memory/decisions.md`, `.codex-memory/session-log.md`, canonical Obsidian OneImage docs/MOCs.

- [ ] Run `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run server:build`, gateway tests/audit, and Obsidian `scan-stale-docs`.
- [ ] Run desktop and touch browser checks for crop resize/move and mosaic preview/export.
- [ ] Commit and push to `main`; wait for `verify`, `package`, and `deploy-pxed` to succeed.
- [ ] Confirm deployed revision, Supervisor/Nginx, public health/capabilities, and public crop/mosaic export.
- [ ] Update canonical docs and project memory with verified production evidence; finish with a clean working tree.
