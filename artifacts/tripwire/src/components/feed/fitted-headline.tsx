import { useLayoutEffect, useRef } from 'react';

/** Fit the actual title into the space remaining below a card's metadata. */
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
      const height = box.clientHeight;
      title.style.display = 'block';
      title.style.webkitLineClamp = '';
      title.style.webkitBoxOrient = '';
      const fits = (size: number) => {
        title.style.fontSize = `${size}px`;
        return title.scrollHeight <= height && title.scrollWidth <= box.clientWidth;
      };
      let low = 12;
      let high = 26;
      if (!fits(high)) {
        while (high - low > 0.25) {
          const middle = (low + high) / 2;
          if (fits(middle)) low = middle;
          else high = middle;
        }
        if (!fits(low)) {
          // At very narrow widths, keep a readable minimum and expose the full
          // headline through the button's accessible name, tooltip and reader.
          title.style.display = '-webkit-box';
          title.style.webkitBoxOrient = 'vertical';
          title.style.webkitLineClamp = String(Math.max(1, Math.floor(height / (low * 1.2))));
        }
      }
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
