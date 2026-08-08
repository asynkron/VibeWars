// A frame-time and draw-call readout, so a rendering change can be shown
// to have helped rather than argued to have.
//
// Draw calls are the TOTAL for the frame -- shadow pass, bloom chain,
// scene and minimap together. three resets info.render at the top of every
// renderer.render(), and the shadow map is rendered inside that same call,
// so there is no seam to read the shadow pass off separately. Rather than
// pretend otherwise, `info.autoReset` is turned off and the counter is
// reset once per frame here, which makes the number mean "everything this
// frame cost" instead of "whatever the last render() happened to do".
//
// To attribute the shadow share, toggle renderer.shadowMap.enabled and
// diff -- a measurement, not an estimate.
//
// Median rather than mean: one GC pause or shader compile would drag a
// mean around and hide the steady state. p95 sits next to it so those
// stalls stay visible instead of being smoothed away.

const WINDOW = 90;

interface Sample {
    frameMs: number;
    calls: number;
    triangles: number;
    programs: number;
}

class FrameStats {
    private static samples: Sample[] = [];
    private static lastFrame = 0;
    private static element: HTMLElement | null = null;
    private static lastPaint = 0;
    static enabled = false;

    static setEnabled(on: boolean, renderer?: any): void {
        this.enabled = on;
        this.samples.length = 0;
        this.lastFrame = 0;
        if (renderer?.info) {
            // Owned by us while the HUD is up; handed back when it is not.
            renderer.info.autoReset = !on;
        }
        if (!on && this.element) {
            this.element.remove();
            this.element = null;
        }
    }

    // Call at the TOP of the render loop, before any rendering.
    static beginFrame(renderer: any): void {
        if (this.enabled) renderer?.info?.reset?.();
    }

    // Call at the END of the render loop, after every pass.
    static endFrame(now: number, renderer: any): void {
        if (!this.enabled) return;
        const info = renderer?.info;

        // A hidden tab throttles requestAnimationFrame to a crawl or stops
        // it outright, so the gaps it produces are page stalls, not frame
        // times. Sampling them poisons the window for a long time
        // afterwards -- a reading of "83 ms median, p95 34 s" is measuring
        // how long the tab was in the background. Drop the sample and
        // restart the clock so the first visible frame is not charged for
        // the whole invisible interval either.
        if (typeof document !== 'undefined' && document.hidden) {
            this.lastFrame = 0;
            return;
        }

        if (this.lastFrame > 0) {
            this.samples.push({
                frameMs: now - this.lastFrame,
                calls: info?.render?.calls ?? 0,
                triangles: info?.render?.triangles ?? 0,
                programs: info?.programs?.length ?? 0,
            });
            if (this.samples.length > WINDOW) this.samples.shift();
        }
        this.lastFrame = now;

        // Repaint at 4 Hz: a readout that changes every frame is unreadable,
        // and writing to the DOM 60 times a second would show up in the
        // number it is reporting.
        if (now - this.lastPaint > 250) {
            this.lastPaint = now;
            this.paint();
        }
    }

    private static percentile(values: number[], p: number): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    }

    static snapshot() {
        const frames = this.samples.map((s) => s.frameMs);
        const median = this.percentile(frames, 0.5);
        const last = this.samples[this.samples.length - 1];
        return {
            frames: this.samples.length,
            medianMs: +median.toFixed(2),
            p95Ms: +this.percentile(frames, 0.95).toFixed(2),
            fps: median > 0 ? +(1000 / median).toFixed(1) : 0,
            calls: last?.calls ?? 0,
            triangles: last?.triangles ?? 0,
            programs: last?.programs ?? 0,
        };
    }

    private static paint(): void {
        if (!this.element) {
            this.element = document.createElement('div');
            this.element.id = 'frame-stats';
            document.body.appendChild(this.element);
        }
        // PARKED AGAINST THE TOOLBAR, measured rather than guessed. Both
        // pages used to place this at a hardcoded right: 320px, which was
        // the toolbar's width on the day it was written -- adding the Bloom
        // button made the toolbar wider and the two overlapped. Read where
        // the toolbar actually starts instead, and the readout stays put
        // however many toggles it grows. paint() runs at 4 Hz, so this also
        // follows a window resize without listening for one.
        const toolbar = document.getElementById('view-toolbar');
        if (toolbar) {
            const rect = toolbar.getBoundingClientRect();
            this.element.style.right = `${Math.round(window.innerWidth - rect.left + 8)}px`;
            this.element.style.top = `${Math.round(rect.top)}px`;
        }

        const s = this.snapshot();
        this.element.textContent =
            `${s.medianMs.toFixed(1)} ms   ${s.fps} fps   p95 ${s.p95Ms.toFixed(1)} ms\n` +
            `${s.calls} draws   ${(s.triangles / 1000).toFixed(1)}k tris   ${s.programs} programs`;
    }
}

export { FrameStats };
