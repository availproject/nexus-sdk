import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import useOutsideClick from '../../hooks/useOutsideClick';
import { cn } from '../../utils/utils';

interface SelectOption {
  label: string;
  value: string;
  [key: string]: any;
}

interface Position {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  transformOrigin: string;
}

interface AnimatedSelectProps<T extends SelectOption = SelectOption> {
  options: T[];
  defaultValue?: string;
  value?: string;
  onSelect?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  renderSelectedValue?: (option: T) => React.ReactNode;
  renderOption?: (option: T) => React.ReactNode;
}

const AnimatedSelect = <T extends SelectOption = SelectOption>({
  options,
  defaultValue,
  value,
  onSelect,
  placeholder = 'Select an option',
  className,
  disabled = false,
  renderSelectedValue,
  renderOption,
}: AnimatedSelectProps<T>) => {
  const [selectedValue, setSelectedValue] = useState(value || defaultValue);
  const [isOpen, setIsOpen] = useState(false);

  // Sync with external value changes
  useEffect(() => {
    setSelectedValue(value || defaultValue);
  }, [value, defaultValue]);
  const [position, setPosition] = useState<Position>({
    top: 0,
    left: 0,
    width: 0,
    transformOrigin: 'top',
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useOutsideClick(dropdownRef, () => {
    if (isOpen) {
      setIsOpen(false);
    }
  });

  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || !dropdownRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const dropdownHeight = dropdownRef.current.offsetHeight || 200; // Estimate if not measured
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const spaceBelow = viewportHeight - triggerRect.bottom - 8; // 8px margin
    const spaceAbove = triggerRect.top - 8; // 8px margin

    // Determine vertical position
    const shouldPositionAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;

    // Determine horizontal position
    const dropdownWidth = dropdownRef.current.offsetWidth || 200;
    let left = triggerRect.left;

    // Adjust if dropdown would go off-screen on the right
    if (left + dropdownWidth > viewportWidth) {
      left = viewportWidth - dropdownWidth - 8;
    }

    // Adjust if dropdown would go off-screen on the left
    if (left < 8) {
      left = 8;
    }

    setPosition({
      ...(shouldPositionAbove
        ? { bottom: viewportHeight - triggerRect.top + 8 }
        : { top: triggerRect.bottom + 8 }),
      left,
      width: triggerRect.width,
      transformOrigin: shouldPositionAbove ? 'bottom' : 'top',
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      calculatePosition();
      window.addEventListener('resize', calculatePosition);
      window.addEventListener('scroll', calculatePosition);
    }
    return () => {
      window.removeEventListener('resize', calculatePosition);
      window.removeEventListener('scroll', calculatePosition);
    };
  }, [isOpen, calculatePosition]);

  const handleSelect = (option: T) => {
    setSelectedValue(option.value);
    setIsOpen(false);
    onSelect?.(option.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        setIsOpen(!isOpen);
        break;
      case 'Escape':
        setIsOpen(false);
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        }
        break;
    }
  };

  const selectedOption = options.find((opt) => opt.value === selectedValue);
  const displayValue = selectedOption?.label || placeholder;

  return (
    <div className="relative w-full">
      <button
        ref={triggerRef}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          'data-[placeholder]:text-muted-foreground [&_svg:not([class*="text-"])]:text-muted-foreground  focus-visible:outline-none placeholder:font-medium aria-invalid:ring-destructive/20  aria-invalid:border-destructive gap-2 text-base placeholder:text-base whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4 nexus-font-primary px-4 py-2 min-h-12 rounded-[8px] border border-zinc-400 w-full cursor-pointer bg-transparent flex justify-between items-center',
          {
            'opacity-50': disabled,
          },
          className,
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby="select-label"
        data-state={isOpen ? 'open' : 'closed'}
        data-placeholder={!selectedOption ? 'true' : undefined}
        data-slot="select-trigger"
        data-size="default"
        role="combobox"
      >
        <span
          data-slot="select-value"
          className={cn(
            'text-black text-base font-semibold nexus-font-primary leading-normal truncate line-clamp-1 flex items-center gap-2',
            {
              'text-zinc-500': !selectedOption,
            },
          )}
          style={{ pointerEvents: 'none' }}
        >
          {selectedOption && renderSelectedValue
            ? renderSelectedValue(selectedOption)
            : displayValue}
        </span>
        <motion.svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4 opacity-50"
          aria-hidden="true"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <path d="m6 9 6 6 6-6" />
        </motion.svg>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={dropdownRef}
            initial={{
              opacity: 0,
              scale: 0.95,
              y: position.transformOrigin === 'top' ? -10 : 10,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
            }}
            exit={{
              opacity: 0,
              scale: 0.95,
              y: position.transformOrigin === 'top' ? -10 : 10,
            }}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 15,
            }}
            style={{
              position: 'fixed',
              width: position.width,
              transformOrigin: position.transformOrigin,
              zIndex: 50,
            }}
            className="nexus-font-primary w-full text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-max  overflow-x-hidden overflow-y-auto rounded-[8px] shadow-md data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1 bg-[#FAFAFA]"
            role="listbox"
            data-state={isOpen ? 'open' : 'closed'}
            data-slot="select-content"
          >
            <div
              className="p-1 w-full scroll-my-1"
              style={{ position: 'relative', flex: '1 1 0%', overflow: 'hidden auto' }}
            >
              {options.map((option, index) => (
                <motion.div
                  key={option.value}
                  onClick={() => handleSelect(option)}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.2 }}
                  className={cn(
                    ' focus:text-accent-foreground cursor-pointer [&_svg:not([class*="text-"])]:text-muted-foreground relative hover:bg-zinc-400 flex w-full items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
                    {
                      'bg-accent text-accent-foreground': selectedOption?.value === option.value,
                    },
                  )}
                  role="option"
                  aria-selected={selectedOption?.value === option.value}
                  data-state={selectedOption?.value === option.value ? 'checked' : 'unchecked'}
                  data-slot="select-item"
                  tabIndex={-1}
                >
                  <span className="absolute right-2 flex size-3.5 items-center justify-center">
                    {selectedOption?.value === option.value && (
                      <svg className="size-4" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </span>
                  <span>{renderOption ? renderOption(option) : option.label}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AnimatedSelect;
