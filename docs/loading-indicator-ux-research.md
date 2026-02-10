# Loading Indicator UX Research

UI/UX research for subtle, professional loading indicators in the evostitch 3D microscopy viewer.

**Date:** 2026-01-16
**Related:** [3D Performance Research](./3D-performance-research.md)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Terminology Glossary](#terminology-glossary)
3. [Pattern Catalog](#pattern-catalog)
4. [Psychology of Perceived Performance](#psychology-of-perceived-performance)
5. [Existing Implementations](#existing-implementations)
6. [Design Recommendations for evostitch](#design-recommendations-for-evostitch)
7. [Implementation Notes](#implementation-notes)
8. [Accessibility Considerations](#accessibility-considerations)
9. [Sources](#sources)

---

## Executive Summary

This document presents research on loading indicator patterns to improve perceived performance in the evostitch 3D microscopy viewer. The goal is to design a **single, subtle, iconographic indicator** that combines two dimensions of "loadedness":

1. **XY Tile Completeness** - How many viewport tiles are loaded vs pending
2. **Z-Plane Availability** - How many adjacent Z-planes are preloaded for smooth navigation

### Key Findings

1. **Perceived performance is more important than actual performance** - Users perceive load times as 15% slower than reality, and remember them as 35% slower
2. **Animation reduces perceived wait time** - Dynamic indicators shorten perceived duration by diverting attention from time-tracking
3. **Skeleton screens outperform spinners** - But for overlay indicators on existing content, subtle ring/arc indicators are more appropriate
4. **Determinate > Indeterminate** - When progress can be measured (as with tiles), showing progress is better than showing activity
5. **Calm animation timing** - 200-500ms durations with ease-in-out feel professional; faster feels urgent, slower feels sluggish

### Recommendation Summary

A **dual-arc circular progress indicator** positioned in the bottom-left corner (near scale bar), using:
- Outer arc: XY tile completion (0-100%)
- Inner arc or fill: Z-plane readiness (adjacent planes cached)
- Semi-transparent background for legibility over varied microscopy backgrounds
- Graceful fade-out when fully loaded
- 300ms animation timing with ease-out easing

---

## Terminology Glossary

### Progress Indicator Types

| Term | Definition |
|------|------------|
| **Determinate indicator** | Shows measurable progress (0-100%). Use when duration/progress is known or estimable. |
| **Indeterminate indicator** | Shows activity without progress (spinning, pulsing). Use when duration is unknown. |
| **Hybrid indicator** | Combines determinate and indeterminate elements, e.g., spinner with progress ring. |

### Loading Patterns

| Term | Definition |
|------|------------|
| **Skeleton screen** | Placeholder UI that mimics final layout with gray shapes; reduces perceived load time by 40% vs spinners. |
| **Progressive loading** | Content appears incrementally, prioritizing essential elements. Users can interact sooner. |
| **LQIP (Low Quality Image Placeholder)** | Tiny (~40px) blurred image shown while full image loads. Used by Facebook, Medium, Next.js. |
| **Blur-up loading** | LQIP variant where low-res image transitions smoothly to high-res. Already implemented in evostitch. |
| **Optimistic loading** | Show expected state immediately, execute in background, handle failures gracefully. |

### Animation Terminology

| Term | Definition |
|------|------------|
| **Easing** | Acceleration/deceleration curve for animation. Natural motion uses ease-in-out, not linear. |
| **Ease-in** | Starts slow, accelerates. "Gentle start." |
| **Ease-out** | Starts fast, decelerates. "Smooth landing." |
| **Ease-in-out** | Slow start and end, fast middle. Best for most UI animations. |
| **Goal gradient effect** | Users are more patient when they feel closer to completion. Progress bars should accelerate toward end. |

### Psychological Concepts

| Term | Definition |
|------|------------|
| **Perceived performance** | Subjective experience of speed, distinct from actual performance. Formula: `perceived = f(expected, UX, actual)` |
| **Attentional Gate Theory** | Dynamic animations divert attention from time-tracking, reducing perceived wait time. |
| **Expectation violation** | Frustration occurs when actual wait exceeds expected wait. Managing expectations reduces frustration. |
| **Watched pot effect** | Static indicators make waits feel longer. Animation breaks the monotony. |

### Technical Terms

| Term | Definition |
|------|------------|
| **stroke-dasharray** | SVG property defining dash pattern. Used to create partial circles for ring progress. |
| **stroke-dashoffset** | SVG property defining dash start offset. Animated to show progress. |
| **aria-live** | Accessibility attribute announcing dynamic content changes to screen readers. |
| **prefers-reduced-motion** | CSS media query detecting user preference for minimal animation. |

---

## Pattern Catalog

### 1. Circular/Ring Progress Indicator

**Description:** Circle with stroke that fills clockwise to show progress.

**Pros:**
- Compact, fits in corners without dominating
- Can show determinate progress (0-100%)
- Can combine multiple data sources (nested rings, segmented arcs)
- Familiar pattern (used by iOS, Android, web apps)

**Cons:**
- Requires SVG for clean implementation
- Progress calculation needed

**Best for:** evostitch - can show tile completion percentage

**Implementation:** Use SVG circle with `stroke-dasharray` equal to circumference, animate `stroke-dashoffset` from circumference to 0.

---

### 2. Linear Progress Bar

**Description:** Horizontal bar that fills left-to-right.

**Pros:**
- Clear progress visualization
- Easy to understand
- Can show multiple segments

**Cons:**
- Takes more horizontal space
- Less compact than circular
- Can feel "utilitarian" rather than professional

**Best for:** File uploads, multi-step processes, not immersive viewers.

---

### 3. Spinner (Indeterminate)

**Description:** Rotating element (dots, arc, or icon).

**Pros:**
- Simple to implement
- Works when progress is unknown
- Familiar pattern

**Cons:**
- No progress information
- Can increase perceived wait time vs. skeleton screens
- Overuse leads to "spinner blindness"

**Best for:** Short, unpredictable waits (1-5 seconds). Not recommended for tile loading where progress is measurable.

**Caution:** Research shows spinners can make users perceive waits as longer. Luke Wroblewski's Polar app saw complaints about "excessive waiting" after adding spinners.

---

### 4. Skeleton Screen

**Description:** Gray placeholder shapes mimicking final content layout.

**Pros:**
- Reduces perceived wait time by up to 40%
- Sets correct expectations for content structure
- Professional appearance

**Cons:**
- Requires knowing final layout
- Not suitable for overlaying existing content
- More complex to implement

**Best for:** Initial page loads, not for tile viewers where content structure is already visible.

---

### 5. Pulsing/Breathing Animation

**Description:** Element that gently scales or changes opacity rhythmically.

**Pros:**
- Very subtle, non-distracting
- Works for indeterminate waits
- Calming aesthetic

**Cons:**
- No progress information
- Can be missed if too subtle

**Best for:** Status indicators, "processing" states where progress is unknown.

---

### 6. Segmented Arc (Multi-Source Progress)

**Description:** Circular arc divided into segments, each representing a different progress dimension.

**Pros:**
- **Combines multiple progress sources into one indicator**
- Compact visualization
- Can show XY completion + Z readiness simultaneously

**Cons:**
- More complex to implement
- Requires clear visual distinction between segments

**Best for:** **evostitch - recommended pattern** for combining XY tile + Z-plane progress.

---

### 7. Dot/Pulse Indicator

**Description:** Small dot that pulses or changes color based on state.

**Pros:**
- Extremely minimal
- Works for simple ready/loading binary states
- Non-intrusive

**Cons:**
- No progress granularity
- Easy to overlook

**Best for:** Simple status indication, not detailed progress.

---

## Psychology of Perceived Performance

### Time Perception Research

| Finding | Implication |
|---------|-------------|
| Users perceive waits as 15% longer than actual | Even 2-second loads feel like 2.3 seconds |
| Memory adds another 20% | A 15-second load is remembered as 20+ seconds |
| After 3 minutes, perceived time multiplies | Never let users wait this long without feedback |
| 100ms feels instantaneous | Don't show indicators for sub-100ms operations |
| 1 second is the limit for "flow" | Beyond this, users notice the delay |
| 10 seconds is patience limit | Provide progress/explanation for longer waits |

### What Reduces Perceived Wait Time

1. **Dynamic animation** - Attentional Gate Theory: movement diverts attention from time-tracking
2. **Progress indication** - Knowing how far along reduces anxiety
3. **Goal gradient** - Progress that accelerates toward completion feels faster
4. **Distraction/engagement** - Content, tips, or micro-interactions during waits
5. **Managing expectations** - Warnings about long operations increase patience

### What Increases Perceived Wait Time

1. **Static indicators** - "Loading..." text without animation
2. **Spinners without progress** - Activity without information
3. **Unexpected delays** - When users expect instant response
4. **Visible placeholder/gray areas** - Blank space draws attention to incompleteness

### Recommendations for evostitch

- **Show progress, not just activity** - Tile count enables determinate indicator
- **Use subtle animation** - Calm, professional, not playful
- **Don't show indicator for <1 second loads** - Avoid flashing indicators
- **Fade out gracefully** - Don't snap to hidden; smooth 300ms fade
- **Consider "loading delay"** - Only show indicator if load takes >300ms

---

## Existing Implementations

### Google Maps

**Approach:** Minimal visual feedback during tile loading.
- No explicit loading spinner in main view
- Tiles appear progressively as they load
- Gray placeholder color for unloaded tiles
- Relies on fast loading rather than indicators

**Lesson:** For fast networks, no indicator is better than a flashing indicator. But evostitch needs to handle slow connections and large datasets.

### Medical Imaging Viewers (OHIF/Cornerstone)

**Approach:** Full-page loading states during initial load, minimal during navigation.
- Progress bar for study loading
- Series thumbnails show loading state per-series
- WebGL rendering minimizes per-tile loading delays

**Lesson:** Medical viewers prioritize initial load feedback, then assume fast interactions. evostitch Z-navigation creates similar "initial load" moments when switching planes.

### Photo Viewers (Google Photos, Apple Photos)

**Approach:** LQIP and progressive loading.
- Blurred thumbnails shown immediately
- Full resolution loads progressively
- No explicit spinners in grid views
- Detail view may show subtle loading indicator

**Lesson:** Blur-up pattern (already in evostitch) handles single-image loading well. Need additional feedback for Z-plane readiness.

### Figma/Design Tools

**Approach:** Subtle corner indicators, optimistic rendering.
- Small loading indicator in toolbar/status area
- Canvas remains interactive during background loads
- No modal/blocking loading states

**Lesson:** Keep the user in control; background loading with subtle feedback is better than blocking.

### Video Players (Buffering)

**Approach:** Central spinner only when playback blocked.
- No indicator while buffering ahead
- Spinner appears only when playback stalls
- Progress bar shows buffer state

**Lesson:** Only interrupt experience when necessary. Preload silently, indicate only when it impacts interaction.

---

## Design Recommendations for evostitch

### Recommended Indicator: Dual-Arc Progress Ring

A compact circular indicator combining XY tile progress and Z-plane readiness.

#### Visual Design

```
        ╭──────────╮
       ╱ ○○○○○○○○○○ ╲     ← Outer arc: XY tile completion (80% shown)
      │   ╭──────╮   │
      │  ╱ ●●●●●● ╲  │    ← Inner arc: Z-plane readiness (60% shown)
      │  │        │  │
      │  ╲        ╱  │
      │   ╰──────╯   │
       ╲            ╱
        ╰──────────╯
```

#### Specifications

| Property | Value | Rationale |
|----------|-------|-----------|
| **Size** | 24-32px diameter | Visible but not dominating |
| **Position** | Bottom-left, above scale bar | Near existing UI, accessible, not over content |
| **Background** | Semi-transparent dark (#000 at 50-70% opacity) | Legibility over light and dark microscopy |
| **Outer arc color** | White or accent blue (#3282b8) | XY tile progress |
| **Inner arc color** | Slightly dimmer (70% opacity of outer) | Z-plane readiness |
| **Track color** | Dark gray (#444 at 50% opacity) | Shows remaining progress |

#### States

| State | Visual | Behavior |
|-------|--------|----------|
| **Hidden** | Not rendered | XY 100% complete AND Z-planes cached for ±radius |
| **Loading** | Both arcs animating | Active tile fetching and/or Z-prefetch |
| **XY Complete, Z Loading** | Outer full, inner animating | Current view ready, prefetching depth |
| **Z Complete, XY Loading** | Outer animating, inner full | Depth ready, loading current tiles |
| **Fully Loaded** | Both arcs full → fade out | 300ms fade to hidden |

#### Animation Timing

| Transition | Duration | Easing |
|------------|----------|--------|
| Arc progress updates | Continuous (no transition) | N/A - follow actual progress |
| Appear (from hidden) | 200ms | ease-out |
| Disappear (to hidden) | 300ms | ease-in |
| Opacity changes | 200ms | ease-in-out |

#### Display Delay

Don't show the indicator immediately - wait 300ms before showing. If loading completes within 300ms, never show the indicator. This prevents flashing on fast loads.

```javascript
// Pseudocode
let showTimer = null;

function onLoadingStart() {
    showTimer = setTimeout(() => {
        indicator.show();
    }, 300);
}

function onLoadingComplete() {
    clearTimeout(showTimer);
    indicator.fadeOut();
}
```

### Position Rationale

**Bottom-left (recommended):**
- Near existing scale bar creates "status corner"
- Away from OpenSeadragon navigator (top-right)
- Away from coordinates display (bottom-right)
- Away from Z-slider (bottom-center)
- Doesn't compete with microscopy content in center

**Alternative - Top-left:**
- Could work if bottom-left feels crowded
- Less ideal for fullscreen where header is hidden

### Legibility Over Varied Backgrounds

Microscopy images can be very light (background) or very dark (specimens). The indicator must be visible in both cases.

**Solution: Subtle backdrop**
```css
.loading-indicator {
    background: rgba(0, 0, 0, 0.6);
    border-radius: 50%;
    padding: 4px;
    backdrop-filter: blur(2px); /* Optional: subtle blur */
}
```

This creates a consistent "island" for the indicator regardless of underlying content.

---

## Implementation Notes

### SVG Structure

```html
<svg class="loading-indicator" viewBox="0 0 36 36" width="32" height="32">
    <!-- Background circle (pill container) -->
    <circle cx="18" cy="18" r="17" fill="rgba(0,0,0,0.6)" />

    <!-- Outer track (XY) -->
    <circle
        cx="18" cy="18" r="14"
        fill="none"
        stroke="rgba(100,100,100,0.3)"
        stroke-width="2"
    />

    <!-- Outer progress (XY tiles) -->
    <circle
        class="xy-progress"
        cx="18" cy="18" r="14"
        fill="none"
        stroke="#3282b8"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray="87.96"
        stroke-dashoffset="87.96"
        transform="rotate(-90 18 18)"
    />

    <!-- Inner track (Z-planes) -->
    <circle
        cx="18" cy="18" r="10"
        fill="none"
        stroke="rgba(100,100,100,0.3)"
        stroke-width="2"
    />

    <!-- Inner progress (Z-planes) -->
    <circle
        class="z-progress"
        cx="18" cy="18" r="10"
        fill="none"
        stroke="rgba(50,130,184,0.7)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-dasharray="62.83"
        stroke-dashoffset="62.83"
        transform="rotate(-90 18 18)"
    />
</svg>
```

### CSS

```css
.loading-indicator {
    position: fixed;
    bottom: 80px; /* Above scale bar */
    left: 20px;
    z-index: 1000;
    opacity: 0;
    transition: opacity 300ms ease-in;
    pointer-events: none; /* Don't block interactions */
}

.loading-indicator.visible {
    opacity: 1;
    transition: opacity 200ms ease-out;
}

/* Reduced motion: no animation, just show/hide */
@media (prefers-reduced-motion: reduce) {
    .loading-indicator {
        transition: none;
    }

    .loading-indicator .xy-progress,
    .loading-indicator .z-progress {
        transition: none;
    }
}
```

### JavaScript Integration

```javascript
// In evostitch namespace
window.evostitch.loadingIndicator = (function() {
    'use strict';

    let element = null;
    let showTimeout = null;
    let isLoading = false;

    const SHOW_DELAY_MS = 300;
    const CIRCUMFERENCE_OUTER = 2 * Math.PI * 14; // ~87.96
    const CIRCUMFERENCE_INNER = 2 * Math.PI * 10; // ~62.83

    function init() {
        // Create SVG element
        element = createIndicatorElement();
        document.body.appendChild(element);
    }

    function setProgress(xyPercent, zPercent) {
        if (!element) return;

        const xyOffset = CIRCUMFERENCE_OUTER * (1 - xyPercent / 100);
        const zOffset = CIRCUMFERENCE_INNER * (1 - zPercent / 100);

        element.querySelector('.xy-progress').style.strokeDashoffset = xyOffset;
        element.querySelector('.z-progress').style.strokeDashoffset = zOffset;

        // Auto-hide when fully loaded
        if (xyPercent >= 100 && zPercent >= 100) {
            hide();
        }
    }

    function show() {
        if (!element || isLoading) return;
        isLoading = true;

        // Delay showing to avoid flash on fast loads
        showTimeout = setTimeout(() => {
            element.classList.add('visible');
        }, SHOW_DELAY_MS);
    }

    function hide() {
        isLoading = false;
        clearTimeout(showTimeout);
        if (element) {
            element.classList.remove('visible');
        }
    }

    return { init, setProgress, show, hide };
})();
```

### Integration with Existing Modules

**Tile Progress (XY):**
Hook into OpenSeadragon's tile events to track viewport completion.

```javascript
viewer.addHandler('tile-loaded', function(event) {
    updateXYProgress();
});

viewer.addHandler('tile-unloaded', function(event) {
    updateXYProgress();
});

function updateXYProgress() {
    const tiledImage = viewer.world.getItemAt(currentZ);
    if (!tiledImage) return;

    // Get coverage for current viewport
    const coverage = tiledImage.getCoverageRatioForLevel(tiledImage.lastDrawnLevel);
    const percent = Math.round(coverage * 100);

    window.evostitch.loadingIndicator.setProgress(percent, zReadinessPercent);
}
```

**Z-Plane Readiness:**
Track which adjacent Z-planes have loaded tiles.

```javascript
function updateZReadiness() {
    const radius = deviceConfig.preloadRadius;
    let planesReady = 0;
    let planesTotal = 0;

    for (let dz = -radius; dz <= radius; dz++) {
        const z = currentZ + dz;
        if (z >= 0 && z < zCount) {
            planesTotal++;
            if (isPlaneReady(z)) {
                planesReady++;
            }
        }
    }

    const percent = Math.round((planesReady / planesTotal) * 100);
    window.evostitch.loadingIndicator.setProgress(xyPercent, percent);
}
```

---

## Accessibility Considerations

### Screen Reader Support

```html
<svg class="loading-indicator"
     role="progressbar"
     aria-valuemin="0"
     aria-valuemax="100"
     aria-valuenow="75"
     aria-label="Loading tiles: 75% complete">
    <!-- SVG content -->
</svg>
```

Update `aria-valuenow` and `aria-label` as progress changes.

For the dual-progress nature:
```html
<div class="loading-indicator-container"
     role="status"
     aria-live="polite"
     aria-label="Loading: viewport 80% complete, depth navigation 60% ready">
```

### Reduced Motion

Users with vestibular disorders may be sensitive to animation. Respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
    .loading-indicator {
        /* Remove fade transitions */
        transition: none;
    }

    .loading-indicator circle {
        /* Remove any stroke animations */
        transition: none;
    }
}
```

In JavaScript:
```javascript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (prefersReducedMotion) {
    // Skip animation, just show/hide
    element.style.transition = 'none';
}
```

### Color Contrast

The indicator should meet WCAG 2.1 requirements:
- **3:1 minimum contrast** for UI components
- Blue (#3282b8) on dark background (#000 at 60%): passes
- White on dark background: passes

Consider providing a high-contrast mode or automatically adjusting based on underlying image brightness (advanced).

### Focus Management

Loading indicators should not receive focus or interfere with keyboard navigation:

```css
.loading-indicator {
    pointer-events: none; /* Cannot be clicked */
}
```

Do not add `tabindex` to the indicator.

### Alternative Text Feedback

For users who cannot see the indicator, consider:
- Announcing "Loading" when indicator appears (via aria-live)
- Announcing "Loaded" when indicator disappears
- Limiting announcement frequency to avoid noise

```javascript
function announceLoadingState(isLoading) {
    const announcer = document.getElementById('loading-announcer');
    if (announcer) {
        announcer.textContent = isLoading ? 'Loading image tiles' : 'Image loaded';
    }
}
```

```html
<div id="loading-announcer" class="visually-hidden" role="status" aria-live="polite"></div>
```

---

## Sources

### Perceived Performance & Psychology
- [Shorter Wait Times: Effects of Loading Screens on Perceived Performance](https://www.researchgate.net/publication/302073992_Shorter_Wait_Times_The_Effects_of_Various_Loading_Screens_on_Perceived_Performance) - ResearchGate
- [The Psychology of Web Performance](https://www.uptrends.com/blog/the-psychology-of-web-performance) - Uptrends
- [Perceived Performance - Don't Forget the User](https://www.keycdn.com/blog/perceived-performance) - KeyCDN
- [Website Loading Animation and Perceived Waiting Time](https://www.mdpi.com/0718-1876/20/4/306) - MDPI
- [The Psychology of Waiting: Skeletons](https://medium.com/@elenech/the-psychology-of-waiting-skeletons-ca3b309e12a2) - Medium

### Loading Indicator Design Patterns
- [Loading & Progress Indicators - UI Components Series](https://uxdesign.cc/loading-progress-indicators-ui-components-series-f4b1fc35339a) - UX Collective
- [UX Design Patterns for Loading](https://www.pencilandpaper.io/articles/ux-pattern-analysis-loading-feedback) - Pencil & Paper
- [Best Practices for Animated Progress Indicators](https://www.smashingmagazine.com/2016/12/best-practices-for-animated-progress-indicators/) - Smashing Magazine
- [Loading Spinners: Purpose and Alternatives](https://blog.logrocket.com/ux-design/loading-spinners-purpose-alternatives/) - LogRocket
- [Skeleton Loading Screen Design](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/) - LogRocket
- [Progress Indicators - Material Design 3](https://m3.material.io/components/progress-indicators/overview) - Google

### SVG Progress Implementation
- [Building a Progress Ring, Quickly](https://css-tricks.com/building-progress-ring-quickly/) - CSS-Tricks
- [SVG Radial Progress Meters](https://codepen.io/xgad/post/svg-radial-progress-meters) - CodePen
- [SVG Circle Progress Bar](https://nikitahl.com/svg-circle-progress) - Nikita Hlopov

### Accessibility
- [Notification of Loading/Busy](https://www.w3.org/WAI/GL/wiki/Notification_of_Loading/Busy) - W3C WAI
- [Accessible Loading Indicators](https://dockyard.com/blog/2020/03/02/accessible-loading-indicatorswith-no-extra-elements) - DockYard
- [Loading Spinner Accessibility](https://codeaccessible.com/codepatterns/loading-spinner/) - Code Accessible
- [Design Accessible Animation and Movement](https://blog.pope.tech/2025/12/08/design-accessible-animation-and-movement/) - Pope Tech

### Animation & Easing
- [Quick Start Guide to Modern UI Animation](https://clay.global/blog/ux-guide/ui-animation) - Clay
- [The Complete Guide to Animation Easing](https://www.adobe.com/uk/creativecloud/animation/discover/easing.html) - Adobe
- [Easing Functions](https://motion.dev/docs/easing-functions) - Motion

### Map & Viewer Implementations
- [Progress Indicator - Map UI Patterns](https://mapuipatterns.com/progress-indicator/) - Map UI Patterns
- [Prototyping a Smoother Map](https://medium.com/google-design/google-maps-cb0326d165f5) - Google Design
- [OHIF Viewer](https://ohif.org/) - Open Health Imaging Foundation
- [Cornerstone3D](https://www.cornerstonejs.org/) - CornerstoneJS

### Progressive Image Loading
- [Blurry Image Placeholders on the Web](https://www.mux.com/blog/blurry-image-placeholders-on-the-web) - Mux
- [LQIP Explained](https://cloudinary.com/blog/low_quality_image_placeholders_lqip_explained) - Cloudinary
- [LQIP Your Images for Fast Loading](https://blog.imgix.com/2016/06/01/lqip-your-images) - imgix

---

## Next Steps

1. **Prototype** - Create standalone HTML/CSS/JS demo of the dual-arc indicator
2. **User testing** - Test indicator visibility on various microscopy backgrounds
3. **Integration** - Hook into tile-prioritizer and viewer events
4. **Iteration** - Adjust size, colors, timing based on feedback
