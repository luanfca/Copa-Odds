'use client';

import { useEffect } from 'react';

export function MouseTracker() {
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const card = (e.target as HTMLElement).closest('.match-card') as HTMLElement;
      if (card) {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return null;
}
