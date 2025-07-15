import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  backgroundImage?: string;
  children?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ 
  title, 
  subtitle, 
  backgroundImage,
  children 
}) => {
  return (
    <div style={{
      background: backgroundImage 
        ? `linear-gradient(rgba(42, 77, 143, 0.8), rgba(42, 77, 143, 0.8)), url(${backgroundImage})` 
        : 'linear-gradient(135deg, #2a4d8f 0%, #1e3b73 100%)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      color: '#fff',
      padding: '40px 20px',
      marginBottom: '32px'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto'
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
