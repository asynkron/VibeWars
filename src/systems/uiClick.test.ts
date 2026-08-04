// The guard that keeps a click on the interface from being read as a click
// on the world.
//
// This is a regression test with a name attached. The map's click listener
// is on WINDOW, so every click in the document reaches it -- including the
// skill bar's own buttons, which bubble. It then raycasts at the pointer,
// finds whatever hex lies behind the button, fails to make a legal move of
// it, and falls through to the branch that CLEARS THE SELECTION.
//
// So arming a skill deselected the unit it was being armed for, and the
// next click had nothing to act with: clicking Load did, visibly, nothing
// at all. The skill bar's own tests could never catch it -- they run in
// jsdom, where there is no camera, no raycaster and no hex behind anything.

import '../test/threeStub';
import { describe, it, expect, beforeEach } from 'vitest';
import { isUiClick } from '../game';

describe('a click on the interface is not a click on the map', () => {
    beforeEach(() => { document.body.replaceChildren(); });

    const inside = (html: string, selector: string) => {
        document.body.insertAdjacentHTML('beforeend', html);
        return document.querySelector(selector)!;
    };

    it('ignores a skill button', () => {
        // The one that shipped broken.
        const button = inside('<div id="skill-bar"><button class="skill"><span class="skill-glyph">X</span></button></div>', '.skill');
        expect(isUiClick(button)).toBe(true);
    });

    it('ignores the glyph INSIDE a skill button', () => {
        // What the browser actually reports as the target: the innermost
        // element under the pointer, which is the span, not the button.
        const glyph = inside('<div id="skill-bar"><button class="skill"><span class="skill-glyph">X</span></button></div>', '.skill-glyph');
        expect(isUiClick(glyph)).toBe(true);
    });

    it('ignores the bar itself, gaps included', () => {
        const bar = inside('<div id="skill-bar"></div>', '#skill-bar');
        expect(isUiClick(bar)).toBe(true);
    });

    it('ignores the view toolbar, the minimap and the start menu', () => {
        for (const [html, selector] of [
            ['<div id="view-toolbar"><button class="view-toggle">Grid</button></div>', '.view-toggle'],
            ['<div id="minimap-overlay"></div>', '#minimap-overlay'],
            ['<div id="start-menu"><button>Human vs AI</button></div>', '#start-menu button'],
        ] as const) {
            document.body.replaceChildren();
            expect(isUiClick(inside(html, selector)), selector).toBe(true);
        }
    });

    it('lets a click on the canvas through', () => {
        const canvas = inside('<canvas></canvas>', 'canvas');
        expect(isUiClick(canvas)).toBe(false);
    });

    it('lets a click on nothing through rather than swallowing it', () => {
        expect(isUiClick(null)).toBe(false);
        expect(isUiClick(document as unknown as EventTarget)).toBe(false);
    });
});
