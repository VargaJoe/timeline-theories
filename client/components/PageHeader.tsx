import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backgroundImage?: string;
  overlayOpacity?: number; // 0.0 to 1.0, default 0.4
  children?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ 
  title, 
  subtitle, 
  backgroundImage,
  overlayOpacity = 0.4,
  children 
}) => {
  // Debug logging for background image
  React.useEffect(() => {
    console.log('[PageHeader] Background image prop:', backgroundImage);
  }, [backgroundImage]);

  const backgroundStyle = backgroundImage 
    ? `linear-gradient(rgba(42, 77, 143, ${overlayOpacity}), rgba(42, 77, 143, ${overlayOpacity})), url(${backgroundImage})` 
    : 'linear-gradient(135deg, #1e3b73 0%, #2a4d8f 20%, #3d5aa3 40%, #4a6bb5 60%, #2a4d8f 80%, #1e3b73 100%)';

  console.log('[PageHeader] Background style:', backgroundStyle);

  return (
    <div style={{
      background: backgroundStyle,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      color: '#fff',
      padding: '48px 24px',
      minHeight: '220px',
      marginBottom: '32px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      <div style={{
        width: '1200px',
        marginLeft: 'auto',
        padding: '0 20px',
        marginRight: 'auto',
        textAlign: 'left'
      }}>
        <h1 style={{
          fontSize: '36px',
          fontWeight: 'bold',
          margin: '0 0 8px 0',
          textShadow: '0 2px 4px rgba(0,0,0,0.3)'
        }}>
          {title}
        </h1>
        
        {subtitle && (
          <p style={{
            fontSize: '18px',
            margin: '0 0 24px 0',
            opacity: 0.9,
            textShadow: '0 1px 2px rgba(0,0,0,0.3)'
          }}>
            {subtitle}
          </p>
        )}
        
        {children && (
          <div style={{
            marginTop: '24px'
          }}>
            {children}
          </div>
        )}
      </div>
    </div>
  );
};
