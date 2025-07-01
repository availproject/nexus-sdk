import React, { useState, useRef, useEffect } from 'react';

interface DraggableProps {
  children: React.ReactNode;
  className?: string;
  handle?: string;
}

export const Draggable: React.FC<DraggableProps> = ({
  children,
  className = '',
  handle = '.drag-handle',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;

      setPosition({
        x: position.x + deltaX,
        y: position.y + deltaY,
      });

      setDragStart({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragStart, position]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(handle)) {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        e.preventDefault();
      }
    };

    element.addEventListener('mousedown', handleMouseDown);

    return () => {
      element.removeEventListener('mousedown', handleMouseDown);
    };
  }, [handle]);

  return (
    <div
      ref={elementRef}
      className={className}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      {children}
    </div>
  );
};
