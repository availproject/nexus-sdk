export const locationHost = (): string => {
  if (typeof window === 'undefined') {
    return 'localhost';
  }

  return window.location.host;
};

export const locationOrigin = (): string => {
  if (typeof window === 'undefined') {
    return 'https://localhost';
  }

  return window.location.origin;
};
