import { LazyImage } from './LazyImage';
import { PosterFan } from './PosterFan';
import { posterStripCount, type ImageDescriptor } from '../utils/imageVariants';

export function TimelineCover({ image, label }: { image: ImageDescriptor; label: string }) {
  const count = posterStripCount(image);
  return <LazyImage src="" image={image} alt={label}
    resolutionScale={count ? 1.5 : 1}
    renderImage={count ? source => <PosterFan source={source} count={count} label={label} /> : undefined}
    style={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
}
