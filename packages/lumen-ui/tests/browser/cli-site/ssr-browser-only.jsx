if (typeof window === 'undefined') throw new Error('A deferred browser module was evaluated during static rendering');

export default function BrowserOnly() { return <p>Browser-only component</p>; }
