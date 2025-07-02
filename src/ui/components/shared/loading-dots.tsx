import React from 'react';
import { motion } from 'motion/react';

const LoadingDots = () => (
  <div className="relative flex items-center w-full justify-center">
    <motion.span
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.7, repeat: Infinity }}
      className="absolute size-1.5 rounded-full bg-white left-2"
    ></motion.span>
    <motion.span
      initial={{ x: 0 }}
      animate={{ x: 24 }}
      transition={{ duration: 0.7, repeat: Infinity }}
      className="absolute size-1.5 rounded-full bg-white left-2"
    ></motion.span>
    <motion.span
      initial={{ x: 0 }}
      animate={{ x: 24 }}
      transition={{ duration: 0.7, repeat: Infinity }}
      className="absolute size-1.5 rounded-full bg-white left-8"
    ></motion.span>
    <motion.span
      initial={{ scale: 1 }}
      animate={{ scale: 0 }}
      transition={{ duration: 0.7, repeat: Infinity }}
      className="absolute size-1.5 rounded-full bg-white left-14"
    ></motion.span>
  </div>
);
export default LoadingDots;
