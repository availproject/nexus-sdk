import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../utils/utils';
import { createPortal } from 'react-dom';

interface DialogContextType {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DialogContext = React.createContext<DialogContextType | null>(null);

function useDialog() {
  const context = React.useContext(DialogContext);
  if (!context) {
    throw new Error('Dialog components must be used within a Dialog');
  }
  return context;
}

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Dialog({ open = false, onOpenChange, children }: DialogProps) {
  const handleOpenChange = React.useCallback(
    (newOpen: boolean) => {
      onOpenChange?.(newOpen);
    },
    [onOpenChange],
  );

  return (
    <DialogContext.Provider value={{ open, onOpenChange: handleOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

function DialogTrigger({ asChild = false, onClick, ...props }: DialogTriggerProps) {
  const { onOpenChange } = useDialog();

  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      onOpenChange(true);
    },
    [onClick, onOpenChange],
  );

  if (asChild) {
    return React.cloneElement(React.Children.only(props.children as React.ReactElement), {
      onClick: handleClick,
      'data-slot': 'dialog-trigger',
    } as any);
  }

  return <button {...props} onClick={handleClick} data-slot="dialog-trigger" />;
}

interface DialogPortalProps {
  children: React.ReactNode;
  container?: HTMLElement;
}

function DialogPortal({ children, container }: DialogPortalProps) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(children, container || document.body);
}

interface DialogOverlayProps
  extends Omit<
    React.HTMLAttributes<HTMLDivElement>,
    'onDrag' | 'onDragEnd' | 'onDragStart' | 'onAnimationStart' | 'onAnimationEnd'
  > {}

const DialogOverlay = React.forwardRef<HTMLDivElement, DialogOverlayProps>(
  ({ className, ...props }, ref) => {
    const { onOpenChange } = useDialog();

    return (
      <motion.div
        ref={ref}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'fixed inset-0 z-50 bg-[#0E0E0E66] backdrop-blur-[4px] overflow-y-hidden',
          className,
        )}
        onClick={() => onOpenChange(false)}
        {...props}
      />
    );
  },
);
DialogOverlay.displayName = 'DialogOverlay';

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  onPointerDownOutside?: (event: React.PointerEvent) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, onPointerDownOutside, onEscapeKeyDown, ...props }, ref) => {
    const { open, onOpenChange } = useDialog();

    // Handle escape key
    React.useEffect(() => {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onEscapeKeyDown?.(e);
          if (!e.defaultPrevented) {
            onOpenChange(false);
          }
        }
      };

      if (open) {
        document.addEventListener('keydown', handleEscape);
      }

      return () => {
        document.removeEventListener('keydown', handleEscape);
      };
    }, [open, onEscapeKeyDown, onOpenChange]);

    return (
      <AnimatePresence>
        {open && (
          <DialogPortal>
            <DialogOverlay />
            <div
              ref={ref}
              role="dialog"
              data-state={open ? 'open' : 'closed'}
              className={cn(
                'fixed left-[50%] top-[50%] z-50 max-w-lg translate-x-[-50%] translate-y-[-50%] shadow-lg duration-200',
                'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                'data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]',
                'data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]',
                'sm:rounded-[8px]',
                className,
              )}
              tabIndex={-1}
              style={{ pointerEvents: 'auto' }}
              onClick={(e) => e.stopPropagation()}
              {...props}
            >
              {children}
            </div>
          </DialogPortal>
        )}
      </AnimatePresence>
    );
  },
);
DialogContent.displayName = 'DialogContent';

interface DialogCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

function DialogClose({ asChild = false, onClick, ...props }: DialogCloseProps) {
  const { onOpenChange } = useDialog();

  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      onOpenChange(false);
    },
    [onClick, onOpenChange],
  );

  if (asChild) {
    return React.cloneElement(React.Children.only(props.children as React.ReactElement), {
      onClick: handleClick,
      'data-slot': 'dialog-close',
    } as any);
  }

  return <button {...props} onClick={handleClick} data-slot="dialog-close" />;
}

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn(
        'text-2xl font-semibold leading-none tracking-tight nexus-font-primary',
        className,
      )}
      {...props}
    />
  ),
);
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
DialogDescription.displayName = 'DialogDescription';

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
