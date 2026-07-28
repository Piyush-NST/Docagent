'use client';

import FeatureSlider from '@/components/FeatureSlider';

export interface ScrollyStep {
  id: string;
  kicker?: string;
  title: string;
  subtitle?: string;
  description?: string;
  tags: string[];
  bullets: string[];
  panelTitle: string;
  panelBody: string;
  panelMeta?: string;
  visual: 'grounded' | 'ocr' | 'workspace' | 'pipeline' | 'sources' | 'ready';
}

interface ScrollyStoryProps {
  id: string;
  eyebrow: string;
  steps: ScrollyStep[];
}

export default function ScrollyStory({ id, eyebrow, steps }: ScrollyStoryProps) {
  return (
    <section className="features-section" id={id} aria-label={eyebrow}>
      <FeatureSlider steps={steps} eyebrow={eyebrow} heading="Built for grounded document work" />
    </section>
  );
}
