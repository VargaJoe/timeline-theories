import type { CSSProperties } from 'react';
import { posterStripLayout } from '../utils/posterStripLayout.mjs';
import './PosterFan.css';

export interface PosterFanProps {
  source: string;
  count: number;
  label: string;
}

type FanStyle = CSSProperties & { [name: `--${string}`]: string | number };

/** Decorative windows into one already-authorized poster-strip bitmap. */
export function PosterFan({ source, count, label }: PosterFanProps) {
  if (!source || !Number.isSafeInteger(count) || count < 1 || count > 4) return null;
  const slots = posterStripLayout(count);
  const cardWidth = [120, 108, 104, 100][count - 1];
  const middle = (count - 1) / 2;
  const style: FanStyle = { '--poster-fan-source': `url(${JSON.stringify(source)})` };

  return <div className="poster-fan" data-poster-fan="" role="img" aria-label={label} style={style}>
    {slots.map((slot, index) => {
      // Exclude the saved card border and its shadow from the movable face.
      const crop = { x: slot.x + 2, y: slot.y + 2, width: slot.width - 4, height: slot.height - 4 };
      const offset = index - middle;
      const angle = offset * (count === 2 ? 18 : count === 3 ? 13 : 10.5);
      const centerY = count === 1 ? 96 : count === 2 ? 102 : 96 + Math.abs(offset) * (count === 3 ? 10 : 8);
      const card: FanStyle = {
        left: `${(200 + offset * 57) / 4}%`, top: `${centerY / 2}%`,
        width: `${cardWidth / 4}%`, height: `${cardWidth * crop.height / crop.width / 2}%`,
        '--poster-fan-angle': `${angle}deg`,
        '--poster-fan-layer': count - Math.round(Math.abs(offset) * 2) + (index >= middle ? 1 : 0),
      };
      const face: CSSProperties = {
        backgroundSize: `${400 / crop.width * 100}% ${200 / crop.height * 100}%`,
        backgroundPosition: `${crop.x / (400 - crop.width) * 100}% ${crop.y / (200 - crop.height) * 100}%`,
      };
      return <span className="poster-fan__card" key={index} aria-hidden="true" data-poster-index={index} style={card}>
        <span className="poster-fan__surface" style={face} />
      </span>;
    })}
  </div>;
}

export default PosterFan;
