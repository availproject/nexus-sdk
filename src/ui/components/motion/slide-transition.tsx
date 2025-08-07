import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface SlideTransitionProps {
  contentKey: string;
  direction?: 'horizontal' | 'vertical';
  distance?: number;
  timing?: {
    stiffness?: number;
    damping?: number;
    mass?: number;
  };
  children: React.ReactNode;
  className?: string;
}

export interface SlideDirections {
  initial: { x?: number; y?: number; opacity: number };
  animate: { x?: number; y?: number; opacity: number };
  exit: { x?: number; y?: number; opacity: number };
}

export const SlideTransition: React.FC<SlideTransitionProps> = ({
  contentKey,
  direction = 'horizontal',
  distance = 50,
  timing = { stiffness: 350, damping: 40, mass: 1 },
  children,
  className = '',
}) => {
  const getSlideDirections = (): SlideDirections => {
    if (direction === 'vertical') {
      return {
        initial: { y: distance, opacity: 0 },
        animate: { y: 0, opacity: 1 },
        exit: { y: -distance, opacity: 0 },
      };
    }

    return {
      initial: { x: distance, opacity: 0 },
      animate: { x: 0, opacity: 1 },
      exit: { x: -distance, opacity: 0 },
    };
  };

  const slideProps = getSlideDirections();

  return (
    <div className={`w-full h-full overflow-hidden ${className}`}>
      <AnimatePresence mode="wait">
        <motion.div
          key={contentKey}
          initial={slideProps.initial}
          animate={slideProps.animate}
          exit={slideProps.exit}
          transition={{
            type: 'spring',
            stiffness: timing.stiffness,
            damping: timing.damping,
            mass: timing.mass,
          }}
          className="w-full h-full"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
