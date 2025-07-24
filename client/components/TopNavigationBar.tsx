import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useOidcAuthentication } from '@sensenet/authentication-oidc-react';
import { LoginButton } from './LoginButton';
import { siteConfig } from '../configuration';

export const TopNavigationBar: React.FC = () => {
  const { oidcUser } = useOidcAuthentication();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav style={{
      background: '#2a4d8f',
      borderBottom: '1px solid #1e3b73',
      padding: '0 20px',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '60px'
      }}>
        {/* Logo/Brand */}
        <Link 
          to="/" 
          style={{
            color: '#fff',
            textDecoration: 'none',
            fontSize: '24px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flex: 1
          }}
        >
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span style={{ 
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {siteConfig.siteTitle}
          </span>
        </Link>

        {/* Desktop Navigation Links */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 32
        }}
        className="desktop-nav">
          <Link 
            to="/timelines" 
            style={{
              color: '#fff',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 500,
              padding: '8px 12px',
              borderRadius: 6,
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Timelines
          </Link>
          
          <Link 
            to="/media-library" 
            style={{
              color: '#fff',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 500,
              padding: '8px 12px',
              borderRadius: 6,
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
          >
            Media Library
          </Link>

          {/* Desktop User Profile/Login */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}>
            {oidcUser ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                color: '#fff'
              }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: '#fff',
                  color: '#2a4d8f',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}>
                  {(oidcUser.profile?.name || oidcUser.profile?.preferred_username || oidcUser.profile?.email || 'U').charAt(0)?.toUpperCase()}
                </div>
                <span style={{ fontSize: '14px' }}>
                  {oidcUser.profile?.name || oidcUser.profile?.preferred_username || oidcUser.profile?.email?.split('@')[0] || 'User'}
                </span>
                <LoginButton />
              </div>
            ) : (
              <LoginButton />
            )}
          </div>
        </div>

        {/* Mobile Hamburger Menu Button */}
        <button
          className="mobile-menu-button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          style={{
            display: 'none',
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '4px',
            transition: 'background 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div 
          className="mobile-menu"
          style={{
            display: 'none',
            background: '#2a4d8f',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            padding: '16px 0'
          }}
        >
          <Link 
            to="/timelines" 
            style={{
              color: '#fff',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 500,
              padding: '12px 20px',
              display: 'block',
              borderBottom: '1px solid rgba(255,255,255,0.1)'
            }}
            onClick={() => setMobileMenuOpen(false)}
          >
            Timelines
          </Link>
          
          <Link 
            to="/media-library" 
            style={{
              color: '#fff',
              textDecoration: 'none',
              fontSize: '16px',
              fontWeight: 500,
              padding: '12px 20px',
              display: 'block',
              borderBottom: '1px solid rgba(255,255,255,0.1)'
            }}
            onClick={() => setMobileMenuOpen(false)}
          >
            Media Library
          </Link>

          {/* Mobile User Profile/Login */}
          <div style={{
            padding: '12px 20px'
          }}>
            {oidcUser ? (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                color: '#fff'
              }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: '#fff',
                  color: '#2a4d8f',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  fontSize: '14px'
                }}>
                  {(oidcUser.profile?.name || oidcUser.profile?.preferred_username || oidcUser.profile?.email || 'U').charAt(0)?.toUpperCase()}
                </div>
                <span style={{ fontSize: '14px', flex: 1 }}>
                  {oidcUser.profile?.name || oidcUser.profile?.preferred_username || oidcUser.profile?.email?.split('@')[0] || 'User'}
                </span>
                <LoginButton />
              </div>
            ) : (
              <LoginButton />
            )}
          </div>
        </div>
      )}
    </nav>
  );
};
