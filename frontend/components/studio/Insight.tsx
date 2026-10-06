import { ReactNode } from 'react';

/** One plain sentence that explains a number, with an optional action beside it. */
export default function Insight({ children, action, tone = 'light' }: { children: ReactNode; action?: ReactNode; tone?: 'light' | 'ink' }) {
  return (
    <div className={`st-insight ${tone === 'ink' ? 'ink' : ''}`}>
      <span className="st-ai" aria-hidden="true">AI</span>
      <span className="st-insight-text">{children}</span>
      {action && <span className="st-insight-act">{action}</span>}
    </div>
  );
}
