import React from 'react';

interface MediaCoverMontageProps {
  coverUrls: string[];
  timelineName: string;
}

export const MediaCoverMontage: React.FC<MediaCoverMontageProps> = ({ coverUrls, timelineName }) => {
  // If no covers available, show the clock icon fallback
  if (!coverUrls || coverUrls.length === 0) {
    return (
      <svg width="48" height="48" fill="none" stroke="rgba(255,255,255,0.7)" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  // For 1 cover, show it centered
  if (coverUrls.length === 1) {
    return (
      <div style={{
        width: 120,
        height: 160,
        borderRadius: 8,
        overflow: 'hidden',
        border: '2px solid rgba(255,255,255,0.3)'
      }}>
        <img 
          src={coverUrls[0]} 
          alt={`${timelineName} media`}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
          onError={(e) => {
            // Fallback to clock icon if image fails to load
            e.currentTarget.style.display = 'none';
            const parent = e.currentTarget.parentElement;
            if (parent) {
              parent.innerHTML = '<svg width="48" height="48" fill="none" stroke="rgba(255,255,255,0.7)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>';
              parent.style.display = 'flex';
              parent.style.alignItems = 'center';
              parent.style.justifyContent = 'center';
            }
          }}
        />
      </div>
    );
  }

  // For multiple covers, show Trakt-style horizontal card list
  const displayCovers = coverUrls.slice(0, 4);
  const cardWidth = Math.min(60 + (140 / displayCovers.length), 90); // Dynamic width based on count
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      height: 160,
      width: '100%',
      padding: '0 20px'
    }}>
      {displayCovers.map((coverUrl, index) => (
        <div
          key={index}
          style={{
            width: cardWidth,
            height: 140,
            borderRadius: 6,
            overflow: 'hidden',
            border: '2px solid rgba(255,255,255,0.2)',
            transition: 'all 0.3s ease',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
          onMouseEnter={(e) => {
            // Expand hovered card and compress others
            e.currentTarget.style.width = `${cardWidth * 1.4}px`;
            e.currentTarget.style.transform = 'translateY(-4px)';
            e.currentTarget.style.zIndex = '10';
            e.currentTarget.style.border = '2px solid rgba(255,255,255,0.6)';
            
            // Compress sibling cards
            const parent = e.currentTarget.parentElement;
            if (parent) {
              Array.from(parent.children).forEach((sibling, siblingIndex) => {
                if (siblingIndex !== index && sibling instanceof HTMLElement) {
                  sibling.style.width = `${cardWidth * 0.7}px`;
                  sibling.style.opacity = '0.7';
                }
              });
            }
          }}
          onMouseLeave={(e) => {
            // Reset all cards to normal state
            e.currentTarget.style.width = `${cardWidth}px`;
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.zIndex = '1';
            e.currentTarget.style.border = '2px solid rgba(255,255,255,0.2)';
            
            // Reset sibling cards
            const parent = e.currentTarget.parentElement;
            if (parent) {
              Array.from(parent.children).forEach((sibling) => {
                if (sibling instanceof HTMLElement) {
                  sibling.style.width = `${cardWidth}px`;
                  sibling.style.opacity = '1';
                }
              });
            }
          }}
        >
          <img 
            src={coverUrl} 
            alt={`${timelineName} media ${index + 1}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
            onError={(e) => {
              // Hide broken images gracefully
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      ))}
    </div>
  );
};
