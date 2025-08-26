import React from 'react';
import { cn } from '../../utils/utils';
import type { ModalProps } from '../../types';
import { Dialog, DialogContent } from './dialog-motion';
import { motion } from 'motion/react';

export function BaseModal({ isOpen, onClose, children, className }: ModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          'p-0 bg-nexus-ring-offset text-foreground rounded-nexus-xl shadow-card w-[480px] min-h-[500px]',
          className,
        )}
      >
        <motion.div
          layoutId="tx-processor"
          layout="position"
          className="relative flex flex-col h-full w-full min-h-[500px] overflow-hidden text-nexus-foreground"
        >
          {children}
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
