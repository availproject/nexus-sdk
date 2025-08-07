'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../utils/utils';

interface DrawerProps {
  children: React.ReactNode;
}

interface DrawerContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const DrawerContext = React.createContext<DrawerContextType | null>(null);

function Drawer({ children }: DrawerProps) {
  const [isOpen, setIsOpen] = React.useState(false);

  return <DrawerContext.Provider value={{ isOpen, setIsOpen }}>{children}</DrawerContext.Provider>;
}

function DrawerTrigger({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const context = React.useContext(DrawerContext);
  if (!context) throw new Error('DrawerTrigger must be used within a Drawer');

  const { setIsOpen } = context;

  return (
    <div className={cn('cursor-pointer', className)} onClick={() => setIsOpen(true)} {...props}>
      {children}
    </div>
  );
}

function DrawerContent({ children, className }: { children: React.ReactNode; className?: string }) {
  const context = React.useContext(DrawerContext);
  if (!context) throw new Error('DrawerContent must be used within a Drawer');

  const { isOpen, setIsOpen } = context;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-nexus-backdrop backdrop-blur-[4px] z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Drawer Content */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{
              type: 'spring',
              damping: 30,
              stiffness: 400,
              mass: 0.8,
            }}
            className={cn(
              'absolute bottom-0 left-0 right-0 bg-white rounded-t-xl z-50 max-h-[80%] overflow-hidden flex flex-col shadow-xl',
              className,
            )}
            style={{
              transformOrigin: 'bottom',
            }}
          >
            {/* Content */}
            <div className="flex-1 overflow-y-auto">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerClose({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const context = React.useContext(DrawerContext);
  if (!context) throw new Error('DrawerClose must be used within a Drawer');

  const { setIsOpen } = context;

  return (
    <div className={cn('cursor-pointer', className)} onClick={() => setIsOpen(false)} {...props}>
      {children}
    </div>
  );
}

function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-0.5 text-center', className)} {...props} />;
}

function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-auto flex flex-col gap-2 p-4', className)} {...props} />;
}

function DrawerTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-nexus-foreground font-semibold font-nexus-primary text-lg', className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-nexus-muted-foreground text-sm', className)} {...props} />;
}

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
