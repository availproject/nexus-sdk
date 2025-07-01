import React from 'react';
import { cn } from '../../utils/utils';
import type { ModalProps } from '../../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { AvailLogo } from './icons/AvailLogo';
import { useInternalNexus } from '../../providers/InternalNexusProvider';

export function BaseModal({ isOpen, onClose, children, title, className }: ModalProps) {
  const { activeTransaction } = useInternalNexus();
  const showHeader =
    activeTransaction?.status !== 'processing' &&
    activeTransaction?.status !== 'success' &&
    activeTransaction?.status !== 'error';
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          'p-0 bg-gray-100 text-foreground rounded-2xl shadow-card w-[480px] min-h-[600px] h-auto',
          showHeader && 'flex flex-col items-center justify-between',
          className,
        )}
      >
        {/* Header */}
        {showHeader && (
          <DialogHeader className="flex flex-row items-center justify-between relative px-6 py-5 h-[88px] w-full">
            <AvailLogo className="absolute top-0 left-1/2 -translate-x-1/2 opacity-10" />
            <DialogTitle className="font-semibold">{title}</DialogTitle>
          </DialogHeader>
        )}

        {/* Content */}
        {children}
      </DialogContent>
    </Dialog>
  );
}
