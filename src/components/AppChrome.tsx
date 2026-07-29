'use client';

import React from 'react';
import { motion } from 'framer-motion';

interface AppChromeProps {
  children: React.ReactNode;
}

export default function AppChrome({ children }: AppChromeProps) {
  return (
    <main className="app-root">
      <div className="ambient-grid" />
      <motion.div
        className="glow-orb glow-orb-one"
        aria-hidden
        animate={{ opacity: [0.35, 0.55, 0.35], scale: [1, 1.06, 1] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="glow-orb glow-orb-two"
        aria-hidden
        animate={{ opacity: [0.25, 0.45, 0.25], scale: [1.05, 1, 1.05] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="app-shell">{children}</div>
    </main>
  );
}
