/**
 * Resizable Box Component with Horizontal Drag Handle
 *
 * Provides a container with a draggable separator that allows resizing
 * the height of a section in the TUI.
 */

import { type JSX, children as solidChildren, useContext } from "solid-js";
import {
  BoxRenderable,
  type MouseEvent,
  type RenderContext,
  OptimizedBuffer,
  RGBA,
} from "@opentui/core";
import { RendererContext } from "@opentui/solid";

export interface ResizableBoxProps {
  height: number;
  minHeight?: number;
  maxHeight?: number;
  onResize: (height: number) => void;
  children: JSX.Element;
  invertDelta?: boolean;
}

/**
 * Custom drag handle that responds to mouse events
 */
class DragHandle extends BoxRenderable {
  private isDragging = false;
  private dragStartY = 0;
  private initialHeight = 0;
  private _minHeight: number;
  private _maxHeight: number;
  private getCurrentHeight: () => number;
  private onResizeCallback: (height: number) => void;
  private invertDelta: boolean;

  constructor(
    ctx: RenderContext,
    minHeight: number,
    maxHeight: number,
    getCurrentHeight: () => number,
    onResize: (height: number) => void,
    invertDelta: boolean = false,
  ) {
    super(ctx, {
      height: 1,
      width: "100%",
      backgroundColor: RGBA.fromHex("#30363D"),
      border: false,
    });
    this._minHeight = minHeight;
    this._maxHeight = maxHeight;
    this.getCurrentHeight = getCurrentHeight;
    this.onResizeCallback = onResize;
    this.invertDelta = invertDelta;
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    super.renderSelf(buffer);

    // Draw the separator line
    const color = this.isDragging
      ? RGBA.fromHex("#7aa2f7")
      : RGBA.fromHex("#565f89");
    const bg = this.isDragging
      ? RGBA.fromHex("#7aa2f7")
      : RGBA.fromHex("#30363D");

    for (let x = 0; x < this.width; x++) {
      buffer.drawText("═", this.x + x, this.y, color, bg);
    }
  }

  protected override onMouseEvent(event: MouseEvent): void {
    switch (event.type) {
      case "down":
        this.isDragging = true;
        this.dragStartY = event.y;
        this.initialHeight = this.getCurrentHeight();
        event.stopPropagation();
        break;

      case "drag":
        if (this.isDragging) {
          const deltaY = event.y - this.dragStartY;
          const adjustedDelta = this.invertDelta ? -deltaY : deltaY;
          const newHeight = Math.max(
            this._minHeight,
            Math.min(this._maxHeight, this.initialHeight + adjustedDelta),
          );

          this.onResizeCallback(newHeight);
          event.stopPropagation();
        }
        break;

      case "drag-end":
      case "up":
        if (this.isDragging) {
          this.isDragging = false;
          event.stopPropagation();
        }
        break;
    }
  }
}

/**
 * ResizableBox component - renders content with a draggable separator at the bottom
 */
export function ResizableBox(props: ResizableBoxProps) {
  const renderer = useContext(RendererContext);
  if (!renderer) {
    throw new Error("ResizableBox must be used within a renderer context");
  }

  const minHeight = props.minHeight ?? 5;
  const maxHeight = props.maxHeight ?? 100;

  const dragHandle = new DragHandle(
    renderer,
    minHeight,
    maxHeight,
    () => props.height,
    props.onResize,
    props.invertDelta,
  );

  const childrenFn = solidChildren(() => props.children);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      flexBasis={props.height}
      minHeight={minHeight}
    >
      {/* Content area */}
      <box flexGrow={1} flexDirection="column">
        {childrenFn()}
      </box>

      {/* Drag handle at bottom */}
      {dragHandle}
    </box>
  );
}
