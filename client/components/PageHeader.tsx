import React from 'react';
import { siteConfig } from '../configuration';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backgroundImage?: string;
  overlayOpacity?: number; // 0.0 to 1.0, default 0.4
  children?: React.ReactNode;
  showSiteTitle?: boolean; // Whether to show site title above page title
}

export const PageHeader: React.FC<PageHeaderProps> = ({ 
  title, 
  subtitle, 
  backgroundImage,
  overlayOpacity = 0.4,
  children,
  showSiteTitle = false
}) => {
  // Debug logging for background image
  React.useEffect(() => {
    console.log('[PageHeader] Background image prop:', backgroundImage);
  }, [backgroundImage]);

  // Get site title from configuration
  const siteTitle = siteConfig.siteTitle;

  const backgroundStyle = backgroundImage 
    ? `linear-gradient(rgba(42, 77, 143, ${overlayOpacity}), rgba(42, 77, 143, ${overlayOpacity})), url(${backgroundImage})` 
    : 'linear-gradient(135deg, #1e3b73 0%, #2a4d8f 20%, #3d5aa3 40%, #4a6bb5 60%, #2a4d8f 80%, #1e3b73 100%)';

  console.log('[PageHeader] Background style:', backgroundStyle);

  return (
    <div 
      className="page-header"
      style={{
        backgroundImage: backgroundStyle,
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
      }}
    >
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '0 20px',
        textAlign: 'left',
        width: '100%'
      }}>
        {showSiteTitle && (
          <div style={{
            fontSize: '14px',
            fontWeight: 500,
            color: 'rgba(255, 255, 255, 0.8)',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}>
            {siteTitle}
          </div>
        )}
        
        <h1 style={{
          fontSize: '3.5rem',
          fontWeight: 'bold',
          margin: '0 0 12px 0',
          lineHeight: '1.1',
          textShadow: '0 2px 4px rgba(0,0,0,0.3)',
          wordWrap: 'break-word',
          hyphens: 'auto'
        }}>
          {title}
        </h1>
        
        {subtitle && (
          <h2 style={{
            fontSize: '1.25rem',
            fontWeight: 400,
            margin: '0 0 24px 0',
            color: 'rgba(255, 255, 255, 0.9)',
            lineHeight: '1.4',
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            wordWrap: 'break-word',
            hyphens: 'auto'
          }}>
            {subtitle}
          </h2>
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
