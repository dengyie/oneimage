# Crop Interaction and Local Mosaic Design

## Goal

Make crop selection resizing and movement usable with mouse and touch, and add a local pixelation (mosaic) redaction region to the browser-local editor.

## Evidence and root cause

- The production editor starts with `crop` equal to the full source bounds. `updateCropGesture('move', ...)` clamps movement to those bounds, so the crop frame cannot move until it is first reduced.
- Crop handles are 14×14 CSS pixels, making them difficult to grab, especially on touch screens. When the editor is below the viewport, the user also has to bring the handle into view before a drag can begin.
- `LocalAdjustment` currently stores only color/sharpen/blur values. The renderer has no pixelation operation or local redaction state.

## Interaction design

- Keep the initial crop equal to the full image, preserving the current no-op export behavior.
- Increase the crop handles' pointer/touch hit area while keeping their visible markers compact. Add a concise hint explaining that the frame must first be reduced before it can move within the image.
- Preserve pointer capture and source-coordinate geometry. Resizing continues to respect the selected aspect ratio and image bounds; moving a reduced frame remains bounded by the source.
- Add a dedicated “打码区域” action that creates a centered local region with a visible boundary. The region can be moved using the existing local-region gesture and can be selected from the explicit adjustment-target controls.
- A selected mosaic region exposes a pixel-block size control. Mosaic is composited after global and local color adjustments so the selected pixels are obscured in both preview and export.
- The mosaic stays browser-local, participates in undo/redo/reset, and exports at source resolution through the existing renderer.

## State and rendering

- Extend `LocalAdjustment` with an optional mosaic block size; neutral color adjustments remain independently editable on the same region.
- Reuse the existing local-region geometry, rotation/mirror mapping, and history snapshots.
- Apply pixelation from the already-rendered canvas through a small downscaled canvas, then upscale with smoothing disabled inside the transformed region mask. Work is bounded by the region's output dimensions and chosen block size; the downscaled scratch surface scales with the number of mosaic blocks rather than source pixel count.
- Use the same render implementation for live preview and full-resolution export.

## Validation

- Browser regression: after loading an image, resize a crop edge/corner and verify its visible bounds change; drag the reduced frame and verify its position changes without leaving the image; repeat at a touch viewport and confirm the hit targets are actionable.
- Renderer regression: a mosaic region changes pixels inside its mask, leaves pixels outside untouched, composes over global adjustments, and uses the same state for preview and full-resolution export.
- UI regression: add/select a mosaic region, change block size, move it, undo/redo, and reset; verify it remains local and does not upload the source.
- Run the complete OneImage tests, TypeScript, frontend/server builds, desktop/mobile browser checks, then deploy through GitHub Actions and repeat the public crop/mosaic smoke test.

## Scope

This work changes crop selection interaction and adds rectangular local pixelation. It does not add whole-image scaling, brush strokes, elliptical masks, blur redaction, or server-side image processing.
