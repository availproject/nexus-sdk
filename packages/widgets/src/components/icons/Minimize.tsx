import React from 'react';

interface MinimizeProps {
  className?: string;
  size?: number;
}

export const Minimize: React.FC<MinimizeProps> = ({ className, size = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    role="img"
    aria-hidden="true"
  >
    <path
      d="M9 22H15C20 22 22 20 22 15V9C22 4 20 2 15 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22Z"
      stroke="#4C4C4C"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.00026 14.4883L9.98536 14.4954L9.99243 19.4805"
      stroke="#4C4C4C"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M19.4812 9.99217L14.4961 9.9851L14.489 5"
      stroke="#4C4C4C"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
