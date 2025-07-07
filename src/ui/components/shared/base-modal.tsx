import React from 'react';
import { cn } from '../../utils/utils';
import type { ModalProps } from '../../types';
import { Dialog, DialogContent } from './dialog';
import { useInternalNexus } from '../../providers/InternalNexusProvider';

export function BaseModal({ isOpen, onClose, children, className }: ModalProps) {
  const { activeTransaction } = useInternalNexus();
  const showHeader =
    activeTransaction?.status !== 'processing' &&
    activeTransaction?.status !== 'success' &&
    activeTransaction?.status !== 'error' &&
    activeTransaction?.status !== 'set_allowance';
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          'p-0 bg-gray-100 text-foreground rounded-[16px] shadow-card w-[480px] min-h-[600px]',
          showHeader && 'flex flex-col items-center justify-between',
          className,
        )}
      >
        {/* Content */}
        {children}
      </DialogContent>
    </Dialog>
  );
}
