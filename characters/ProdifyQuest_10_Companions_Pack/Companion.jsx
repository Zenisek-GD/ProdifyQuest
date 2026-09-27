import React, { forwardRef } from 'react';
import CompanionSprite from './CompanionSprite';
import { COMPANIONS_BY_ID } from './catalog';

const Companion = forwardRef(function Companion({ companionId = 'apprentice-mage', ...props }, ref) {
  const companion = COMPANIONS_BY_ID[companionId];
  if (!companion) throw new Error(`Unknown companion: ${companionId}`);
  // Remounting clears old image readiness and queued actions when switching art.
  return <CompanionSprite key={companionId} {...props} ref={ref} spriteSource={companion.source} companionName={companion.name} />;
});

export default Companion;
