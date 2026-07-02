import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

export default function useStdoutDimensions(): [number, number] {
  const { stdout } = useStdout();
  const [dims, setDims] = useState<[number, number]>([stdout?.columns ?? 120, stdout?.rows ?? 40]);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setDims([stdout.columns ?? 120, stdout.rows ?? 40]);
    onResize();
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return dims;
}
