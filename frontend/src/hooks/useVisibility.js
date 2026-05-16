import { useState, useEffect } from 'react';

export const useVisibility = () => {
  const [isHidden, setIsHidden] = useState(document.hidden);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsHidden(document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isHidden;
};
