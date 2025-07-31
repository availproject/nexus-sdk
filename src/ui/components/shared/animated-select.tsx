import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'motion/react';
import useOutsideClick from '../../hooks/useOutsideClick';
import { cn } from '../../utils/utils';
import { Button } from './button-motion';

interface SelectOption {
  label: string;
  value: string;
  [key: string]: any;
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
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ width: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({
      width: rect.width,
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen, updatePosition]);

  useOutsideClick(dropdownRef, (event: MouseEvent | TouchEvent) => {
    if (isOpen) {
      if (triggerRef.current && triggerRef.current.contains(event.target as Node)) {
        return;
      }
      closeDropdown();
    }
  });

  const handleSelect = (option: T) => {
    closeDropdown();
    onSelect?.(option.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (isOpen) {
          closeDropdown();
        } else {
          updatePosition();
          setIsOpen(true);
        }
        break;
      case 'Escape':
        closeDropdown();
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

  const selectedOption = options.find((opt) => opt.value === (value || defaultValue));
  const displayValue = selectedOption?.label || placeholder;

  return (
    <div className="relative w-full">
      <Button
        ref={triggerRef}
        variant="custom"
        size="custom"
        onClick={() => {
          if (disabled) return;
          if (isOpen) {
            closeDropdown();
          } else {
            updatePosition();
            setIsOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={cn(
          'h-12 data-[placeholder]:text-nexus-muted-foreground [&_svg:not([class*="text-"])]:text-nexus-muted-foreground  focus-visible:outline-none placeholder:font-medium aria-invalid:ring-nexus-destructive/20  aria-invalid:border-nexus-destructive gap-2 text-base placeholder:text-base whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4 font-nexus-primary px-4 py-2 rounded-nexus-md border border-zinc-400 w-full cursor-pointer bg-transparent flex justify-between items-center',
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
            'text-black text-base font-semibold font-nexus-primary leading-normal truncate line-clamp-1 flex items-center gap-2',
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
      </Button>
      {isOpen && (
        <div
          ref={dropdownRef}
          className={cn(
            'fixed z-50 font-nexus-primary text-nexus-foreground rounded-nexus-md shadow-md bg-nexus-snow-white',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
          )}
          style={{
            width: position.width,
          }}
          role="listbox"
          data-state={isOpen ? 'open' : 'closed'}
          data-slot="select-content"
        >
          <div className="p-1 w-full overflow-y-auto no-scrollbar" style={{ maxHeight: '308px' }}>
            {options.map((option) => (
              <div
                key={option.value}
                onClick={() => handleSelect(option)}
                className={cn(
                  ' focus:text-nexus-accent-foreground cursor-pointer [&_svg:not([class*="text-"])]:text-nexus-muted-foreground relative hover:bg-nexus-accent/10 flex w-full items-center gap-2 rounded-nexus-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
                  {
                    'bg-nexus-accent text-nexus-accent-foreground':
                      selectedOption?.value === option.value,
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AnimatedSelect;
