import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Polyfill for scroll restoration in React Router v6 with BrowserRouter.
 * Restores scroll position on POP (back/forward), saves on unmount.
 * Optionally supports delayed restoration for long lists/images.
 *
 * Usage: Call useScrollRestoration('unique-key') in your page component.
 */
export function useScrollRestoration(key: string, delay = 0) {
  const location = useLocation();
  const navigationType = useNavigationType();

  // Restore scroll position on POP navigation
  useEffect(() => {
    if (navigationType === 'POP') {
      const y = sessionStorage.getItem('scroll-' + key);
      if (y) {
        if (delay > 0) {
          setTimeout(() => window.scrollTo(0, parseInt(y, 10)), delay);
        } else {
          window.scrollTo(0, parseInt(y, 10));
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // Save scroll position on unmount
  useEffect(() => {
    return () => {
      sessionStorage.setItem('scroll-' + key, String(window.scrollY));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
