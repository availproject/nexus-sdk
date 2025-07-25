import { motion } from 'motion/react';
import * as React from 'react';
import { cn } from '../../utils/utils';

export function WordsPullUp({ text, className = '' }: { text: string; className?: string }) {
  const words = (text || '').split(' ');

  return (
    <div className="flex justify-center flex-wrap">
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: i * 0.1 }}
          className={cn(
            'text-center text-black nexus-font-primary font-semibold text-[24px] tracking-tighter',
            'pr-2', // spacing between words
            className,
          )}
        >
          {word === '' ? '\u00A0' : word}
        </motion.span>
      ))}
    </div>
  );
}
