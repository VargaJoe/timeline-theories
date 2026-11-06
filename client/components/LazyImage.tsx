import React, { useState, useEffect, useRef } from 'react';
import { captureOperationContext, subscribePermissions } from '../services/sensenet';
import { useSharedAuth } from '../context/useSharedAuth';
import { fetchImageBlob, imageRequestQueue } from '../utils/imageLoading';
import { selectImageUrl, type ImageDescriptor } from '../utils/imageVariants';

export interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'loading' | 'srcSet' | 'sizes'> {
  src?: string;
  image?: ImageDescriptor;
  placeholder?: string;
}

export const LazyImage: React.FC<LazyImageProps> = ({ src = '', image: descriptor, alt, placeholder, className, style, onLoad, onError, ...restProps }) => {
  const { accessToken, user, isLoading } = useSharedAuth();
  const element = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribePermissions(() => setRevision(value => value + 1)), []);
  const requestKey = JSON.stringify([src, descriptor, accessToken, user?.Id, user?.sub, isLoading, revision]);
  const [slot, setSlot] = useState<{ key: string; width: number; dpr: number; visible: boolean }>();
  const [image, setImage] = useState<{ key: string; source?: string; loaded: boolean; error: boolean }>();
  const current = image?.key === requestKey ? image : undefined;
  const blocked = !!descriptor && !['active', 'legacy'].includes(descriptor.state);

  useEffect(() => {
    const target = element.current;
    if (!target || isLoading || blocked) return;
    let visible = false, disposed = false;
    const measure = () => {
      if (disposed) return;
      if (!visible) { setSlot(previous => previous?.key === requestKey && previous.visible ? { ...previous, visible: false } : previous); return; }
      const width = target.getBoundingClientRect().width;
      const dpr = window.devicePixelRatio || 1;
      if (width > 0) setSlot(previous => previous?.key === requestKey && previous.width === width && previous.dpr === dpr && previous.visible ? previous : { key: requestKey, width, dpr, visible: true });
    };
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    resize?.observe(target);
    let observer: IntersectionObserver | undefined;
    const checkViewport = () => {
      if (disposed) return;
      const rect = target.getBoundingClientRect();
      visible = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
      measure();
    };
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        measure();
      }, { rootMargin: '0px', threshold: 0 });
      observer.observe(target);
      window.addEventListener('resize', measure);
    } else {
      checkViewport();
      window.addEventListener('scroll', checkViewport, true);
      window.addEventListener('resize', checkViewport);
    }
    return () => {
      disposed = true;
      observer?.disconnect(); resize?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', checkViewport, true);
      window.removeEventListener('resize', checkViewport);
    };
  }, [requestKey, isLoading, blocked]);

  const selectedUrl = slot?.key === requestKey ? selectImageUrl(descriptor, src, slot.width, slot.dpr) : undefined;
  const selectedWidth = descriptor?.state === 'active' ? descriptor.variants?.find(variant => variant.url === selectedUrl)?.width ?? 0 : Infinity;
  // One initial fetch. Growing slots may upgrade an insufficient raster; shrinking never refetches.
  const [selection, setSelection] = useState<{ key: string; url: string; width: number }>();
  useEffect(() => {
    if (selectedUrl) setSelection(previous => previous?.key === requestKey && (previous.url === selectedUrl || previous.width >= selectedWidth)
      ? previous : { key: requestKey, url: selectedUrl, width: selectedWidth });
  }, [selectedUrl, selectedWidth, requestKey]);

  useEffect(() => {
    if (!selection || selection.key !== requestKey || isLoading || blocked) return;
    const controller = new AbortController(), checkContext = captureOperationContext();
    let objectUrl: string | undefined;
    const release = () => { controller.abort(); if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = undefined; } };
    const active = () => {
      if (controller.signal.aborted) return false;
      try { checkContext(); return true; } catch { return false; }
    };
    void imageRequestQueue.run(async () => {
      const blob = await fetchImageBlob(selection.url, { signal: controller.signal, accessToken, assertContext: checkContext });
      if (!active()) return;
      objectUrl = URL.createObjectURL(blob);
      setImage({ key: requestKey, source: objectUrl, loaded: false, error: false });
    }, controller.signal).catch(() => {
      if (active()) setImage({ key: requestKey, loaded: false, error: true });
    });
    return release;
  }, [selection, requestKey, isLoading, blocked, accessToken]);

  const isLoaded = current?.loaded === true;
  const imageStyle: React.CSSProperties = { display: 'block', width: '100%', height: '100%', objectFit: style?.objectFit ?? 'cover', transition: 'opacity 0.3s ease-in-out', opacity: isLoaded ? 1 : 0 };
  const wrapperStyle: React.CSSProperties = { width: '100%', height: '100%', overflow: 'hidden', ...style, position: style?.position ?? 'relative' };
  const placeholderStyle: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 14, background: style?.background ?? style?.backgroundColor ?? '#f0f0f0' };
  return <div ref={element} style={wrapperStyle} data-image-state={blocked ? descriptor?.state : current?.error ? 'error' : isLoaded ? 'loaded' : 'pending'}>
    {!isLoaded && <div style={placeholderStyle} role="img" aria-label={alt}>{placeholder || '📷'}</div>}
    {current?.source && <img {...restProps} src={current.source} alt={alt} className={className} style={imageStyle}
      onLoad={event => { if (current.key === requestKey) setImage(previous => previous?.key === requestKey ? { ...previous, loaded: true } : previous); onLoad?.(event); }}
      onError={event => { setImage(previous => previous?.key === requestKey ? { ...previous, error: true, loaded: false } : previous); onError?.(event); }} />}
  </div>;
};

export default LazyImage;
