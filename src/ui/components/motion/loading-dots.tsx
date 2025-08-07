import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../utils/utils';

const LoadingDots = ({ className, removeWidth }: { className?: string; removeWidth?: boolean }) => (
  <div
    className={cn(
      'relative flex items-center  justify-center',
      className,
      !removeWidth && 'w-full',
    )}
  >
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.7, repeat: Infinity }}
      className="absolute size-1.5 rounded-nexus-full bg-white left-2"
    ></motion.span>
    <motion.span
      initial={{ x: 0 }}
      animate={{ x: 24 }}
      transition={{ duration: 0.7, repeat: Infinity }}
      className="absolute size-1.5 rounded-nexus-full bg-white left-2"
    ></motion.span>
    <motion.span
      initial={{ x: 0 }}
      animate={{ x: 24 }}
      transition={{ duration: 0.7, repeat: Infinity }}
      className="absolute size-1.5 rounded-nexus-full bg-white left-8"
    ></motion.span>
    <motion.span
      initial={{ scale: 1 }}
      animate={{ scale: 0 }}
      transition={{ duration: 0.7, repeat: Infinity }}
      className="absolute size-1.5 rounded-nexus-full bg-white left-14"
    ></motion.span>
  </div>
);
export default LoadingDots;
