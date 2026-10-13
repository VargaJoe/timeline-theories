
import React, { useState, useEffect } from 'react';
import { siteConfig, repositoryUrl } from '../configuration';
import { captureOperationContext, subscribePermissions } from '../services/sensenet';
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
  const { accessToken, user, isLoading } = useSharedAuth();
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribePermissions(() => setRevision(value => value + 1)), []);
  const requestKey = JSON.stringify([src, accessToken, user?.Id, user?.sub, isLoading, revision]);
  const [image, setImage] = useState<{ key: string; source?: string; loaded: boolean; error: boolean }>({ key: '', loaded: false, error: false });
  const currentImage = image.key === requestKey ? image : undefined;
  const isLoaded = currentImage?.loaded === true;
  const hasError = currentImage?.error === true;

  useEffect(() => {
    if (!src || isLoading) return;
    const controller = new AbortController();
    const checkContext = captureOperationContext();
    const active = () => {
      if (controller.signal.aborted) return false;
      try { checkContext(); return true; } catch { return false; }
    };
    const fail = () => {
      if (active()) setImage({ key: requestKey, loaded: false, error: true });
    };
    const executeLoad = async () => {
      try {
        if (!active()) return;
        const imageUrl = new URL(src, window.location.origin);
        const headers: Record<string, string> = {};
        if (accessToken && imageUrl.protocol === 'https:' && imageUrl.origin === new URL(repositoryUrl).origin) {
          headers.Authorization = `Bearer ${accessToken}`;
        }
        imageUrl.searchParams.set('cb', '1');
        const response = await fetch(imageUrl.href, { headers, credentials: 'omit', signal: controller.signal });
        if (!active()) return;
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
        const blob = await response.blob();
        if (!active()) return;
        const reader = new FileReader();
        controller.signal.addEventListener('abort', () => {
          if (reader.readyState === FileReader.LOADING) reader.abort();
        }, { once: true });
        reader.onload = () => {
          if (!active()) return;
          if (typeof reader.result === 'string') setImage({ key: requestKey, source: reader.result, loaded: false, error: false });
          else fail();
        };
        reader.onerror = fail;
        reader.readAsDataURL(blob);
      } catch (error) {
        if (active() && (!(error instanceof Error) || error.name !== 'AbortError')) fail();
      } finally { dequeueRequest(); }
    };
    enqueueRequest(executeLoad);
    return () => controller.abort();
  }, [src, accessToken, isLoading, requestKey]);

  const handleLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setImage(previous => previous.key === requestKey ? { ...previous, loaded: true } : previous);
    onLoad?.(event);
  };
  const handleError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    setImage(previous => previous.key === requestKey ? { ...previous, error: true } : previous);
    onError?.(event);
  };

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
      {currentImage?.source && <img
        src={currentImage.source}
        alt={alt}
        className={className}
        style={imageStyle}
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
        {...restProps}
      />}
    </>
  );
};

export default LazyImage;
