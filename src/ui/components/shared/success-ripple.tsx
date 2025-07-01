import React, { useEffect, useState } from 'react';
import { useNexus } from '../../providers/NexusProvider';

interface SuccessRippleProps {
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SuccessRipple: React.FC<SuccessRippleProps> = ({ children, size = 'md' }) => {
  const { activeTransaction } = useNexus();
  const [showRipple, setShowRipple] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);

  // Size configurations for different contexts
  const sizeConfig = {
    sm: {
      ripple1: 'w-12 h-12',
      ripple2: 'w-10 h-10',
      ripple3: 'w-8 h-8',
    },
    md: {
      ripple1: 'w-16 h-16',
      ripple2: 'w-14 h-14',
      ripple3: 'w-12 h-12',
    },
    lg: {
      ripple1: 'w-20 h-20',
      ripple2: 'w-18 h-18',
      ripple3: 'w-16 h-16',
    },
  };

  const config = sizeConfig[size];

  useEffect(() => {
    if (activeTransaction.status === 'success') {
      setShowRipple(true);
      setAnimationKey((prev) => prev + 1);
    } else {
      setShowRipple(false);
    }
  }, [activeTransaction.status]);

  const rippleAnimation1 = {
    animation: 'fade-out-scale 2s ease-out infinite',
  };

  const rippleAnimation2 = {
    animation: 'fade-out-scale 2s ease-out 0.2s infinite',
  };

  const rippleAnimation3 = {
    animation: 'fade-out-scale 2s ease-out 0.4s infinite',
  };

  return (
    <div className="relative inline-block">
      {showRipple && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div key={`ripple-${animationKey}`} className="absolute">
            <div
              className={`${config.ripple1} rounded-full bg-[#78C47B] opacity-10`}
              style={rippleAnimation1}
            />
          </div>
          <div key={`ripple-2-${animationKey}`} className="absolute">
            <div
              className={`${config.ripple2} rounded-full bg-[#78C47B] opacity-10`}
              style={rippleAnimation2}
            />
          </div>
          <div key={`ripple-3-${animationKey}`} className="absolute">
            <div
              className={`${config.ripple3} rounded-full bg-[#78C47B] opacity-10`}
              style={rippleAnimation3}
            />
          </div>
        </div>
      )}

      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default SuccessRipple;
