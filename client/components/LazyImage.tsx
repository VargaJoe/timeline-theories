
import React, { useState } from 'react';

export interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'loading'> {
  src: string;
  placeholder?: string;
  fallbackSrc?: string;
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  placeholder,
  className,
  style,
  onLoad,
  onError,
  fallbackSrc,
  ...restProps
}) => {
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string>(src);
  const [isLoaded, setIsLoaded] = useState(false);

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setIsLoaded(true);
    onLoad?.(event);
  };

  const handleError = (event: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
      setHasError(false);
    } else {
      setHasError(true);
      onError?.(event);
    }
  };

  // Default placeholder styles
  const placeholderStyle: React.CSSProperties = {
    backgroundColor: '#f0f0f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#999',
    fontSize: '14px',
    minHeight: '100px',
    ...style
  };

  // Image styles with smooth fade-in animation
  const imageStyle: React.CSSProperties = {
    transition: 'opacity 0.3s ease-in-out',
    opacity: isLoaded ? 1 : 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    ...style
  };

  if (hasError) {
    return (
      <div style={{ ...placeholderStyle, backgroundColor: '#ffebee', color: '#c62828' }}>
        ❌ Failed to load
      </div>
    );
  }

  return (
    <>
      {!isLoaded && (
        <div style={placeholderStyle}>
          {placeholder || '📷'}
        </div>
      )}
      <img
        src={currentSrc}
        alt={alt}
        className={className}
        style={imageStyle}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        {...restProps}
      />
    </>
  );
};

export default LazyImage;
