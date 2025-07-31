import React from 'react';

interface MaximizeProps {
  className?: string;
  size?: number;
}

export const Maximize: React.FC<MaximizeProps> = ({ className, size = 24 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    className={className}
    viewBox="0 0 24 24"
    fill="none"
  >
    <path
      d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z"
      stroke="#4C4C4C"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12.4812 16.9922L7.49609 16.9851L7.48902 12"
      stroke="#4C4C4C"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.9993 6.48903L16.9844 6.4961L16.9915 11.4812"
      stroke="#4C4C4C"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
