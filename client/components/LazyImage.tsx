
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { siteConfig } from '../configuration';
import { useSharedAuth } from '../context/useSharedAuth';

// Concurrency control for image loading
let activeRequests = 0;
const maxConcurrent = siteConfig.imageCache.concurrencyLimit;
const requestQueue: Array<() => void> = [];

const processQueue = () => {
  if (activeRequests < maxConcurrent && requestQueue.length > 0) {
    activeRequests++;
    const nextRequest = requestQueue.shift();
    nextRequest?.();
  }
};

const enqueueRequest = (requestFn: () => void) => {
  requestQueue.push(requestFn);
  processQueue();
};

const dequeueRequest = () => {
  activeRequests--;
  processQueue();
};

// Cache management functions (disabled due to localStorage quota issues)
const getCachedImage = (_url: string): string | null => {
  // Disable caching entirely due to localStorage quota issues
  // Images will still work fine with browser HTTP caching
  return null;
};

const setCachedImage = (_url: string, _data: string) => {
  // Disable caching entirely due to localStorage quota issues
  // Images will still work fine with browser HTTP caching
  return;
};

export interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'loading'> {
  src: string;
  placeholder?: string;
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  placeholder,
  className,
  style,
  onLoad,
  onError,
  ...restProps
}) => {
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState<string>(src);
  const [isLoaded, setIsLoaded] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { accessToken } = useSharedAuth();
  const accessTokenRef = useRef(accessToken);

  // Update the ref when accessToken changes
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  const loadImage = useCallback(async () => {
    if (!src) return;

    // Check cache first
    const cached = getCachedImage(src);
    if (cached) {
      setCurrentSrc(cached);
      setIsLoaded(true);
      return;
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();

    const executeLoad = async () => {
      try {
        // Check if we have an access token (get it fresh each time)
        if (!accessTokenRef.current) {
          console.warn('No access token available for image loading');
          setHasError(true);
          return;
        }

        // Always use cache-busting to avoid browser cache CORS issues
        const cacheBustUrl = `${src}${src.includes('?') ? '&' : '?'}cb=1`;

        // Use fetch with authentication to load the image
        const response = await fetch(cacheBustUrl, {
          headers: {
            'Authorization': `Bearer ${accessTokenRef.current}`,
          },
          signal: abortControllerRef.current?.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }

        const blob = await response.blob();

        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result === 'string') {
            setCurrentSrc(result);
            setCachedImage(src, result); // Cache the image
            setIsLoaded(true);
          } else {
            setHasError(true);
          }
        };

        reader.onerror = () => {
          setHasError(true);
        };

        reader.readAsDataURL(blob);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError' && err.message !== 'Aborted') {
          console.error('Image load error:', err);
          setHasError(true);
        }
      } finally {
        dequeueRequest();
      }
    };

    enqueueRequest(executeLoad);
  }, [src]); // Remove accessToken from dependencies

  // Handle image load event
  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setIsLoaded(true);
    if (onLoad) {
      onLoad(event);
    }
  };

  // Handle image error event
  const handleError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setHasError(true);
    if (onError) {
      onError(event);
    }
  };

  useEffect(() => {
    loadImage();

    // Cleanup function to abort ongoing requests
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [src, loadImage]);

  // Default placeholder styles
  const placeholderStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#999',
    fontSize: '14px',
    minHeight: '100px',
    ...style,
    // Only set backgroundColor if parent didn't provide background or backgroundColor
    backgroundColor: style?.background || style?.backgroundColor ? undefined : '#f0f0f0'
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
