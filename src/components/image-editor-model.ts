import { clampCrop, rotatedDimensions, type Rect } from '../domain/editor-state'

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface CropGesture {
  handle: CropHandle
  startPointer: { x: number; y: number }
  startCrop: Rect
  bounds: Rect
  aspectRatio: number | null
}

export function mapPointerToSource(pointer: { x: number; y: number }, source: { width: number; height: number }, rotation: number, flipX: boolean, flipY: boolean): { x: number; y: number } {
  const normalizedRotation = ((rotation % 360) + 360) % 360
  const viewport = rotatedDimensions(source.width, source.height, normalizedRotation)
  const viewportWidth = viewport.width
  const viewportHeight = viewport.height
  let x = pointer.x - viewportWidth / 2
  let y = pointer.y - viewportHeight / 2
  const radians = -normalizedRotation * Math.PI / 180
  const rotatedX = x * Math.cos(radians) - y * Math.sin(radians)
  const rotatedY = x * Math.sin(radians) + y * Math.cos(radians)
  x = flipX ? -rotatedX : rotatedX
  y = flipY ? -rotatedY : rotatedY
  return { x: x + source.width / 2, y: y + source.height / 2 }
}

export function mapSourceRectToViewport(rect: Rect, source: { width: number; height: number }, rotation: number, flipX: boolean, flipY: boolean): Rect {
  const viewport = rotatedDimensions(source.width, source.height, rotation)
  const radians = ((rotation % 360) + 360) % 360 * Math.PI / 180
  const points = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ].map((point) => {
    let x = (point.x - source.width / 2) * (flipX ? -1 : 1)
    let y = (point.y - source.height / 2) * (flipY ? -1 : 1)
    return { x: viewport.width / 2 + x * Math.cos(radians) - y * Math.sin(radians), y: viewport.height / 2 + x * Math.sin(radians) + y * Math.cos(radians) }
  })
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

export function createCropGesture(handle: CropHandle, startPointer: { x: number; y: number }, startCrop: Rect, bounds: Rect, aspectRatio: number | null = null): CropGesture {
  return { handle, startPointer, startCrop, bounds, aspectRatio }
}

export function updateCropGesture(gesture: CropGesture, pointer: { x: number; y: number }): Rect {
  const deltaX = pointer.x - gesture.startPointer.x
  const deltaY = pointer.y - gesture.startPointer.y
  const crop = { ...gesture.startCrop }
  if (gesture.handle === 'move') return clampCrop({ ...crop, x: crop.x + deltaX, y: crop.y + deltaY }, gesture.bounds)
  if (gesture.handle.includes('e')) crop.width += deltaX
  if (gesture.handle.includes('s')) crop.height += deltaY
  if (gesture.handle.includes('w')) { crop.x += deltaX; crop.width -= deltaX }
  if (gesture.handle.includes('n')) { crop.y += deltaY; crop.height -= deltaY }
  if (gesture.aspectRatio !== null) {
    const horizontal = gesture.handle.includes('e') || gesture.handle.includes('w')
    const vertical = gesture.handle.includes('n') || gesture.handle.includes('s')
    if (horizontal && !vertical) crop.height = crop.width / gesture.aspectRatio
    else if (vertical && !horizontal) crop.width = crop.height * gesture.aspectRatio
    else if (horizontal && vertical) {
      const widthFromHeight = crop.height * gesture.aspectRatio
      const heightFromWidth = crop.width / gesture.aspectRatio
      if (Math.abs(deltaX) >= Math.abs(deltaY)) crop.height = heightFromWidth
      else crop.width = widthFromHeight
    }
  }
  return clampCrop(crop, gesture.bounds, gesture.aspectRatio)
}
