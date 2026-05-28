export default function HeroVisual() {
  return (
    <div className="hero-visual" aria-hidden="true">
      <div className="visual-stage">
        <div className="halo-ring" />
        <div className="floating-card doc-card doc-card-pdf">
          <span>PDF</span>
          <div />
          <div />
          <div />
        </div>
        <div className="floating-card doc-card doc-card-docx">
          <span>DOCX</span>
          <div />
          <div />
          <div />
        </div>
        <div className="floating-card answer-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 3 4 7v6c0 5 3.4 7.7 8 8 4.6-.3 8-3 8-8V7z" />
            <path d="m9 12 2 2 4-5" />
          </svg>
          <div>
            <strong>Grounded</strong>
            <span>Answer with sources</span>
          </div>
        </div>
        <div className="chat-bubble-25d">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
