import React, { createContext, useContext, useRef } from 'react';

interface DragConstraintsContextType {
  dragConstraints: React.RefObject<HTMLDivElement | null>;
}

const DragConstraintsContext = createContext<DragConstraintsContextType | null>(null);

export const DragConstraintsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const dragConstraintsRef = useRef<HTMLDivElement>(null);

  return (
    <DragConstraintsContext.Provider value={{ dragConstraints: dragConstraintsRef }}>
      {children}
      {/* Invisible element taking the whole viewport to bound dragging */}
      <div ref={dragConstraintsRef} className="fixed inset-0 pointer-events-none z-50" />
    </DragConstraintsContext.Provider>
  );
};

export const useDragConstraints = () => {
  const context = useContext(DragConstraintsContext);
  if (!context) {
    throw new Error('useDragConstraints must be used within DragConstraintsProvider');
  }
  return context.dragConstraints;
};
