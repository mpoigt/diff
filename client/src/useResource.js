import { useEffect, useState } from 'react';
import { request } from './api';

export function useResource(path) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    request(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ path, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ path, error: error.message });
      });
    return () => controller.abort();
  }, [path]);

  return result?.path === path ? result : null;
}
