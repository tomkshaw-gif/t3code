import { observeVisibleAnimation } from "../../lib/visibleAnimation";

// Synara's ThreadRunningSpinner.tsx: same geometry, 1.3s / 26 stepped frames.
const circumference = 2 * Math.PI * 6.5;

function attachSpinner(element: SVGSVGElement | null) {
  if (!element) return;
  return observeVisibleAnimation(element, () => {
    // Align after visibility starts/resumes the CSS animation. Setting startTime
    // on a paused animation can override its paused state in the Web Animations API.
    for (const animation of element.getAnimations?.() ?? []) {
      try {
        animation.startTime = 0;
      } catch {
        // The animation may have been cancelled while the row was mounting.
      }
    }
  });
}

export function SynaraRunningSpinner() {
  return (
    <svg
      ref={attachSpinner}
      aria-hidden
      viewBox="0 0 15 15"
      fill="none"
      data-legacy-running-spinner
      className="inline-block size-3 shrink-0 text-muted-foreground/55"
    >
      <circle
        cx="7.5"
        cy="7.5"
        r="6.5"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1.4"
      />
      <circle
        cx="7.5"
        cy="7.5"
        r="6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${(0.72 - 0.16) * circumference} ${circumference}`}
        strokeDashoffset={-0.16 * circumference}
      />
    </svg>
  );
}
