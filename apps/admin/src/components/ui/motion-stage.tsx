'use client';

import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';

/** A small, reusable GSAP entrance layer for operational screens. */
export function MotionStage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !stageRef.current) return;
    const context = gsap.context(() => {
      const items = stageRef.current?.querySelectorAll(':scope > * > *');
      if (!items?.length) return;
      gsap.fromTo(items, { autoAlpha: 0, y: 18 }, {
        autoAlpha: 1,
        y: 0,
        duration: 0.52,
        ease: 'power3.out',
        stagger: 0.055,
        clearProps: 'transform,opacity,visibility',
      });
    }, stageRef);
    return () => context.revert();
  }, []);

  return <div ref={stageRef} className="motion-stage">{children}</div>;
}
