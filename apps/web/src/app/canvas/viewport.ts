import { MAX_ZOOM, MIN_ZOOM } from '../constants';
import type { Point, Viewport } from '../types';

export function clampScale(scale: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/**
 * Returns the viewport after changing the scale so that the world point under
 * `anchor` (canvas-relative screen coordinates) stays under it.
 */
export function zoomViewportAt(viewport: Viewport, nextScale: number, anchor: Point): Viewport {
    const scale = clampScale(nextScale);
    const worldX = (anchor.x - viewport.x) / viewport.scale;
    const worldY = (anchor.y - viewport.y) / viewport.scale;
    return {
        scale,
        x: anchor.x - worldX * scale,
        y: anchor.y - worldY * scale
    };
}

/** Pan/zoom state of the canvas and the screen <-> world conversions. */
export class ViewportController {
    viewport: Viewport = { x: 0, y: 0, scale: 1 };

    constructor(
        private readonly canvas: HTMLElement | null,
        private readonly canvasStage: HTMLElement | null,
        private readonly zoomValue: HTMLElement | null
    ) {}

    apply(): void {
        if (this.canvasStage) {
            this.canvasStage.style.transform = `translate(${this.viewport.x}px, ${this.viewport.y}px) scale(${this.viewport.scale})`;
        }
        if (this.zoomValue) {
            this.zoomValue.textContent = `${Math.round(this.viewport.scale * 100)}%`;
        }
    }

    screenToWorld(clientX: number, clientY: number): Point {
        if (!this.canvas) return { x: 0, y: 0 };
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left - this.viewport.x) / this.viewport.scale,
            y: (clientY - rect.top - this.viewport.y) / this.viewport.scale
        };
    }

    /** World coordinates of the centre of the visible canvas, or null before layout. */
    getVisibleCenterWorld(): Point | null {
        if (!this.canvas) return null;
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
            x: (rect.width / 2 - this.viewport.x) / this.viewport.scale,
            y: (rect.height / 2 - this.viewport.y) / this.viewport.scale
        };
    }

    /** Zoom in fixed steps (toolbar buttons), anchored at the canvas centre. */
    zoomByStep(stepPercent: number): void {
        if (!this.canvas) return;
        const snappedScale = Math.round(this.viewport.scale * 10) / 10;
        const newScale = clampScale(snappedScale + stepPercent / 100);
        if (newScale === this.viewport.scale) return;
        const rect = this.canvas.getBoundingClientRect();
        this.viewport = zoomViewportAt(this.viewport, newScale, { x: rect.width / 2, y: rect.height / 2 });
        this.apply();
    }

    /** Zoom to an arbitrary scale keeping the point under the cursor fixed. */
    zoomAtClientPoint(nextScale: number, clientX: number, clientY: number): void {
        if (!this.canvas) return;
        const scale = clampScale(nextScale);
        if (scale === this.viewport.scale) return;
        const rect = this.canvas.getBoundingClientRect();
        this.viewport = zoomViewportAt(this.viewport, scale, { x: clientX - rect.left, y: clientY - rect.top });
        this.apply();
    }

    panTo(x: number, y: number): void {
        this.viewport = { ...this.viewport, x, y };
        this.apply();
    }
}
