import { useRef, useState, useCallback, useLayoutEffect } from 'react';

interface Options {
  align?: 'left' | 'right';
  gap?: number;
}

export function useFixedDropdown(show: boolean, { align = 'left', gap = 4 }: Options = {}) {
  const elRef = useRef<HTMLElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' });

  // Callback ref is contravariant, so (node: HTMLElement | null) => void
  // is assignable to any HTML element's ref prop (button, div, etc.)
  const triggerRef = useCallback((node: HTMLElement | null) => {
    elRef.current = node;
  }, []);

  useLayoutEffect(() => {
    if (!show) {
      setStyle({ visibility: 'hidden' });
      return;
    }

    const update = () => {
      const el = elRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const s: React.CSSProperties = {
        position: 'fixed',
        top: rect.bottom + gap,
        zIndex: 50,
      };
      if (align === 'right') {
        s.right = window.innerWidth - rect.right;
      } else {
        s.left = rect.left;
      }
      setStyle(s);
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [show, align, gap]);

  return { triggerRef, elRef, style };
}
