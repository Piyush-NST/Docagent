'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import StartupScreen from '@/components/StartupScreen';

const STORAGE_KEY = 'docagent-boot-v1';

export default function AppProviders({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState<boolean | null>(null);

  useEffect(() => {
    // sessionStorage is only available after mount
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional client boot gate
    setBooting(sessionStorage.getItem(STORAGE_KEY) !== '1');
  }, []);

  const handleComplete = useCallback(() => {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setBooting(false);
  }, []);

  if (booting === null) {
    return <div style={{ minHeight: '100vh', background: '#050505' }} />;
  }

  return (
    <>
      <AnimatePresence>{booting ? <StartupScreen key="boot" onComplete={handleComplete} /> : null}</AnimatePresence>

      {!booting ? (
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          style={{ transform: 'none' }}
        >
          {children}
        </motion.div>
      ) : null}
    </>
  );
}
