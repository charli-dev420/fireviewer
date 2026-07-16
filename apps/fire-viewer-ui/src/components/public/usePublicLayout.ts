import { useEffect, useState } from 'react';

export type PublicLayoutVariant = 'desktop' | 'mobile';

function readVariant(): PublicLayoutVariant {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
  return window.matchMedia('(max-width: 820px)').matches ? 'mobile' : 'desktop';
}

/**
 * Deux surfaces publiques distinctes sont maintenues : une version desktop et
 * une version mobile. Le basculement se fait ici, sans cascade responsive
 * complexe dans les composants métier.
 */
export function usePublicLayout(): PublicLayoutVariant {
  const [variant, setVariant] = useState<PublicLayoutVariant>(readVariant);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia('(max-width: 820px)');
    const update = () => setVariant(media.matches ? 'mobile' : 'desktop');
    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return variant;
}
