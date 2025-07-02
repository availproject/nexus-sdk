import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

export interface SlideTransitionProps {
  /** Unique key that triggers transitions when changed */
  contentKey: string;
  /** Direction for the slide animation */
  direction?: 'horizontal' | 'vertical';
  /** Custom slide distance in pixels */
  distance?: number;
  /** Animation timing configuration */
  timing?: {
    /** Spring stiffness – lower is softer */
    stiffness?: number;
    /** Spring damping – higher is slower to stop */
    damping?: number;
    /** Spring mass – affects overall weight */
    mass?: number;
  };
  /** Content to render */
  children: React.ReactNode;
  /** Additional CSS classes */
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

    // Horizontal (default)
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

// Hook for common content key mapping patterns
export const useContentKey = (status: string, additionalStates?: string[]) => {
  const getContentKey = (): string => {
    // Common processing states
    if (['processing', 'success', 'error'].includes(status)) {
      return 'processor';
    }

    // Common allowance state
    if (status === 'set_allowance') {
      return 'allowance';
    }

    // Check additional custom states
    if (additionalStates?.includes(status)) {
      return status;
    }

    // Default review states
    return 'review';
  };

  return getContentKey();
};
