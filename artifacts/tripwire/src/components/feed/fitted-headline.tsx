import { useLayoutEffect, useRef } from 'react';

/** Use the shared pane-level font size; fit lines, never individual type sizes. */
export function FittedHeadline({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const title = ref.current;
    const box = title?.parentElement;
    if (!title || !box) return;
    let frame = 0;
    let disposed = false;
    const fit = () => {
      if (disposed || !box.clientWidth || !box.clientHeight) return;
      const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
      // The parent button exposes the complete title through its name/tooltip;
      // opening the reader shows it without truncation.
      title.style.webkitLineClamp = String(Math.max(1, Math.floor(box.clientHeight / lineHeight)));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    void document.fonts.ready.then(schedule);
    document.fonts.addEventListener('loadingdone', schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', schedule);
    };
  }, [text]);

  return <span ref={ref} className="tw-feed-headline w-full overflow-hidden font-serif">{text}</span>;
}
