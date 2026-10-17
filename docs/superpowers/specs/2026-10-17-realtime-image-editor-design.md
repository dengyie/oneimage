# OneImage 实时原图编辑器设计

## 目标

把 OneImage 从“选择工具、填写参数、点击处理”升级为浏览器内的非破坏式图片编辑工作区。用户载入原图后，可以直接在画布上实时看到裁剪、旋转、镜像、色彩调整、锐化、模糊和局部优化结果，并在最终导出时使用原图分辨率重新渲染。

## 范围

本阶段包含：

- 原图只读保存和参数化编辑状态。
- Canvas 实时预览，支持鼠标与触控。
- 裁剪框拖动、四角/四边缩放、固定比例、裁剪边界约束。
- 旋转 90 度、任意角度、水平镜像、垂直镜像。
- 全局亮度、对比度、饱和度、锐化和模糊。
- 可创建多个局部调整区域，每个区域拥有位置、尺寸和局部亮度、对比度、饱和度、锐化、模糊参数。
- 撤销、重做、重置，且切换工具不丢失编辑状态。
- 预览代理和 `requestAnimationFrame` 合帧，避免大图拖动时重复全分辨率渲染。
- 使用原图进行最终导出，沿用现有输出 MIME 和质量配置。

本阶段不包含：服务端编辑、云端项目保存、协作编辑、图层混合模式、自动抠图、AI 修复模型和永久素材库。

## 设计

### 编辑状态

编辑状态是纯数据，不保存 Canvas 或 Blob：

```ts
type Rect = { x: number; y: number; width: number; height: number }
type Adjustments = {
  brightness: number
  contrast: number
  saturation: number
  sharpen: number
  blur: number
}
type LocalAdjustment = { id: string; rect: Rect; adjustments: Adjustments }
type EditorState = {
  crop: Rect
  aspectRatio: number | null
  rotation: number
  flipX: boolean
  flipY: boolean
  adjustments: Adjustments
  localAdjustments: LocalAdjustment[]
}
```

所有坐标均以原图像素为基准。裁剪矩形始终限制在原图边界内，宽高保持正数；固定比例改变时从裁剪中心重算并再次夹紧边界。历史记录保存完整 `EditorState` 快照，撤销和重做使用两个栈，新的编辑会清空重做栈。

### 渲染管线

1. 原图解码一次，生成受最大预览边限制的代理位图。
2. `requestAnimationFrame` 合并连续指针和滑块输入，只渲染最新编辑状态。
3. 预览渲染顺序固定为：裁剪 → 旋转/镜像 → 全局调整 → 局部调整 → 输出到预览 Canvas。
4. 局部调整使用每个区域的矩形 mask；区域外保持全局调整结果。多个区域按数组顺序叠加。
5. 导出时重复同一管线，但输入使用原图尺寸，输出写入现有 `Blob` 下载流程。
6. 渲染任务绑定 `AbortSignal`；新状态或替换图片时取消旧任务，避免旧结果覆盖新预览。

### 交互

- 裁剪工具显示可见边框、四角手柄、四边手柄和中心拖动区域。
- 指针按下记录交互模式和起始状态；移动时将屏幕坐标转换回原图坐标，再执行边界和比例约束。
- 触控使用 `pointer` 事件和 `setPointerCapture`，单指拖动裁剪框；画布缩放通过滚轮或双指手势由浏览器默认缩放策略承载，编辑器不会改变原图状态。
- 工具栏提供旋转、镜像、撤销、重做、重置；按钮在不可用时禁用并提供可访问名称。
- 局部调整先进入“添加区域”模式，拖动创建矩形，创建后显示该区域的控制面板；删除区域不会影响其他历史状态。
- 原图、当前预览和导出结果均明确显示“本地处理”，任何编辑操作不会调用网络接口。

### 性能和资源

- 代理预览最大边为 1600px；导出不受该限制。
- 同一原图只保留一个对象 URL 和一个解码资源；替换图片时释放旧 URL 和旧位图。
- 预览渲染不得在指针移动事件中直接执行同步全尺寸导出。
- 组件卸载、替换文件和取消导出时释放 Worker、对象 URL、动画帧和 AbortController。
- 保留现有 25 MB 输入上限和 JPEG/PNG/WebP 输入策略。

## 文件边界

- `src/domain/editor-state.ts`：编辑状态类型、默认状态、几何约束、历史栈纯函数。
- `src/application/editor-renderer.ts`：预览/导出渲染编排和取消契约。
- `src/infrastructure/editor-canvas.ts`：Canvas 位图、滤镜和局部 mask 的具体实现。
- `src/components/ImageEditor.tsx`：画布、指针手势、工具栏和编辑控制面板。
- `src/App.tsx`：载入图片、编辑器与现有工具注册表/provenance 的边界接线。
- `src/styles.css`：编辑器布局、画布覆盖层、手柄、移动端布局。
- `tests/editor-state.test.ts`：状态、几何约束和历史栈测试。
- `tests/editor-renderer.test.ts`：预览/导出取消和输出一致性测试。
- `tests/image-editor-model.test.ts`：裁剪、旋转坐标和局部区域手势模型测试；真实 DOM 手势由浏览器 QA 验证。

## 验收标准

- 载入 JPEG、PNG、WebP 后，画布立即显示原图；拖动裁剪框或滑块时预览持续更新，无需点击“处理”。
- 裁剪框不能越过原图边界；固定比例和旋转后的尺寸计算正确。
- 旋转、镜像、全局调整和至少两个局部区域可以组合，撤销/重做顺序可重复。
- 导出结果使用原图分辨率，预览与导出对同一编辑状态的几何和调整顺序一致。
- 替换文件或卸载编辑器后无对象 URL、动画帧、Worker 或未完成任务泄漏。
- 现有本地工具、provenance、构建和部署测试不回归。
