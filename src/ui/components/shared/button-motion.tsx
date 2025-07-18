import * as React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../utils/utils';

interface ButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'onDrag' | 'onDragEnd' | 'onDragStart' | 'onAnimationStart' | 'onAnimationEnd'
  > {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | 'custom';
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'custom';
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
}

const buttonVariants = {
  default: 'bg-nexus-primary text-nexus-primary-foreground hover:bg-nexus-primary/90',
  destructive:
    'bg-nexus-destructive text-nexus-destructive-foreground hover:bg-nexus-destructive/90',
  outline:
    'border border-nexus-input bg-nexus-background hover:bg-nexus-accent hover:text-nexus-accent-foreground',
  secondary: 'bg-nexus-secondary text-nexus-secondary-foreground hover:bg-nexus-secondary/80',
  ghost: 'hover:bg-nexus-accent hover:text-nexus-accent-foreground',
  link: 'text-nexus-primary underline-offset-4 hover:underline',
  custom: '',
};

const buttonSizes = {
  default: 'h-10 px-4 py-2',
  sm: 'h-9 rounded-nexus-md px-3',
  lg: 'h-11 rounded-nexus-md px-8',
  icon: 'h-10 w-10',
  custom: '',
};

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ref,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      ref={ref}
      data-slot="button"
      className={cn(
        'inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-nexus-md text-sm font-nexus-primary font-medium ring-offset-nexus-ring-offset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nexus-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 17,
      }}
      {...props}
    />
  );
}

export { Button };
