/** Keeps the card area recognizable while a library's first page is loading. */
export function CollectionPlaceholder({ kind }: { kind: 'timeline' | 'media' }) {
  const timeline = kind === 'timeline';
  return <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${timeline ? 300 : 180}px), 1fr))`, gap: timeline ? 24 : 20 }}>
    {Array.from({ length: timeline ? 3 : 6 }, (_, index) => <div key={index} style={{ border: '1px solid #e9ecef', borderRadius: 12, overflow: 'hidden', background: '#fff', minHeight: timeline ? 400 : 320 }}>
      <div style={{ height: timeline ? 200 : 180, background: '#e6ebf3' }} />
      <div style={{ padding: 24 }}>
        <div style={{ height: 18, width: '72%', background: '#e6ebf3', borderRadius: 4, marginBottom: 20 }} />
        <div style={{ height: 10, background: '#f0f2f5', borderRadius: 4, marginBottom: 10 }} />
        <div style={{ height: 10, width: '60%', background: '#f0f2f5', borderRadius: 4 }} />
      </div>
    </div>)}
  </div>;
}
