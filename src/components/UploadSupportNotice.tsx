'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const DISMISSAL_KEY = 'docagent:upload-support-notice-dismissed';

function ScanIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5.25 2.75H3.5a.75.75 0 0 0-.75.75v1.75M12.75 2.75h1.75a.75.75 0 0 1 .75.75v1.75M5.25 15.25H3.5a.75.75 0 0 1-.75-.75v-1.75M12.75 15.25h1.75a.75.75 0 0 0 .75-.75v-1.75M5.25 9h7.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4.5 4.5 7 7m0-7-7 7" />
    </svg>
  );
}

export default function UploadSupportNotice() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsVisible(window.localStorage.getItem(DISMISSAL_KEY) !== 'true');
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISSAL_KEY, 'true');
    setIsVisible(false);
  };

  return (
    <AnimatePresence initial={false}>
      {isVisible ? (
        <motion.div
          className="upload-support-notice-shell"
          initial={{ height: 0, opacity: 0, y: -4 }}
          animate={{ height: 'auto', opacity: 1, y: 0 }}
          exit={{ height: 0, opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <aside className="upload-support-notice" aria-label="Upload support information">
            <span className="upload-support-icon">
              <ScanIcon />
            </span>
            <div className="upload-support-copy">
              <div className="upload-support-title-row">
                <strong>Upload support is improving</strong>
                <span className="upload-support-beta">BETA</span>
              </div>
              <p>
                Image uploads are still in beta. PNG, JPEG, handwritten, blurry, and large files may be less reliable for
                now.
              </p>
            </div>
            <button
              className="upload-support-dismiss"
              type="button"
              onClick={dismiss}
              aria-label="Dismiss upload support notice"
            >
              <CloseIcon />
            </button>
          </aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
