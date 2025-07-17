import React from 'react';
import { Progress } from './progress-motion';

interface ThreeStageProgressProps {
  progress: number;
  hasError?: boolean;
  errorProgress?: number;
  tokenIcon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

interface ProgressBarState {
  value: number;
  state: 'empty' | 'active' | 'completed' | 'error';
  showToken: boolean;
}

export const ThreeStageProgress: React.FC<ThreeStageProgressProps> = ({
  progress,
  hasError = false,
  errorProgress,
  tokenIcon,
  size = 'md',
  className = '',
}) => {
  const calculateBarStates = (): ProgressBarState[] => {
    const errorPoint = hasError && errorProgress !== undefined ? errorProgress : progress;

    return [
      // First bar (0-33%)
      {
        value: Math.min(Math.max(0, progress * 3), 100),
        state:
          hasError && errorPoint <= 33.33
            ? 'error'
            : progress >= 33.33
              ? 'completed'
              : progress > 0
                ? 'active'
                : 'empty',
        showToken: progress <= 33.33,
      },
      // Second bar (33-66%)
      {
        value: Math.min(Math.max(0, (progress - 33.33) * 3), 100),
        state:
          hasError && errorPoint > 33.33 && errorPoint <= 66.66
            ? 'error'
            : progress >= 66.66
              ? 'completed'
              : progress > 33.33
                ? 'active'
                : 'empty',
        showToken: progress >= 33.33 && progress <= 66.66,
      },
      // Third bar (66-100%)
      {
        value: Math.min(Math.max(0, (progress - 66.66) * 3), 100),
        state:
          hasError && errorPoint > 66.66
            ? 'error'
            : progress > 66.66
              ? progress >= 100
                ? 'completed'
                : 'active'
              : 'empty',
        showToken: progress >= 66.66,
      },
    ];
  };

  const barStates = calculateBarStates();

  // Size configurations
  const sizeConfig = {
    sm: {
      height: 'h-1',
      gap: 'gap-1',
      tokenSize: 'w-4 h-4',
      tokenOffset: '-top-1.5',
      startOffset: 0,
    },
    md: {
      height: 'h-2',
      gap: 'gap-2',
      tokenSize: 'w-6 h-6',
      tokenOffset: '-top-2',
      startOffset: 0,
    },
    lg: {
      height: 'h-2',
      gap: 'gap-3',
      tokenSize: 'w-10 h-10',
      tokenOffset: '-top-4',
      startOffset: 5,
    },
  };

  const config = sizeConfig[size];

  // Get indicator color based on state
  const getIndicatorColor = (state: ProgressBarState['state']) => {
    switch (state) {
      case 'error':
        return 'bg-[#C03C54]';
      case 'completed':
      case 'active':
        return undefined;
      default:
        return undefined;
    }
  };

  return (
    <div className={`w-full flex !nexus-font-primary ${config.gap} ${className}`}>
      {barStates.map((barState, index) => (
        <div key={index} className="relative w-full">
          <Progress
            value={barState.value}
            className={`${config.height} bg-gray-200`}
            indicatorColor={getIndicatorColor(barState.state)}
          />

          {barState.showToken && tokenIcon && (
            <div
              className={`absolute ${config.tokenOffset} ${config.tokenSize} transition-all duration-500 ease-out`}
              style={{
                left: `${barState.value + config.startOffset}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {tokenIcon}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
