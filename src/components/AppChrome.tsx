import React from 'react';

interface AppChromeProps {
  children: React.ReactNode;
}

export default function AppChrome({ children }: AppChromeProps) {
  return (
    <main className="app-root">
      <div className="app-shell">
        <div className="ambient-grid" />
        <div className="glow-orb glow-orb-one" />
        <div className="glow-orb glow-orb-two" />
        <div className="glow-orb glow-orb-three" />
        {children}
      </div>
    </main>
  );
}
