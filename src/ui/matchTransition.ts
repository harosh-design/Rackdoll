/** Animate the menu away while the freshly created match stays frozen. */
export function animateMatchStart(fromMenu: boolean): { finished: Promise<void>; cancel: () => void } {
  const animations: Animation[] = [];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animate = (selector: string, frames: Keyframe[], duration: number, delay = 0) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element || reducedMotion) return;
    animations.push(element.animate(frames, {
      duration, delay, easing: 'cubic-bezier(0.22, 0.7, 0.2, 1)', fill: 'both',
    }));
  };
  if (fromMenu) {
    animate('.lobby-head', [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-38px)' }], 420);
    for (const [side, direction] of [[1, -1], [2, 1]]) {
      animate(`.lobby-player-${side}`, [
        { opacity: 1, transform: 'translateX(0) rotate(0)' },
        { opacity: 0, transform: `translateX(${direction * 90}px) rotate(${direction * 3}deg)` },
      ], 520, 30);
    }
    animate('.lobby-setup', [{ opacity: 1 }, { opacity: 0 }], 400, 90);
    animate('#play', [{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: 0.3 }, { transform: 'scale(0.98)' }], 400);
    animate('#menu', [{ opacity: 1 }, { opacity: 0 }], 500, 250);
  }
  animate('#stage', [
    { opacity: 0, transform: 'scale(0.965)' },
    { opacity: 1, transform: 'scale(1)' },
  ], fromMenu ? 780 : 320, fromMenu ? 160 : 0);
  return {
    finished: Promise.all(animations.map(animation => animation.finished.catch(() => {}))).then(() => {}),
    cancel: () => animations.forEach(animation => animation.cancel()),
  };
}
