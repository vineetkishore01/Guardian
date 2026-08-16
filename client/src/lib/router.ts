import { useState, useEffect, useCallback } from 'react';

/*
 * A ~40-line hash router.
 *
 * Guardian is a single-server dashboard with two views; pulling in a routing
 * library for that would cost more bundle than the feature. Hash routes also
 * survive being served from any sub-path without server-side rewrite rules.
 */

export type Route =
  | { name: 'dashboard' }
  | { name: 'metric'; metric: string }
  | { name: 'logs' };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0];
  const [head, tail] = path.split('/');

  if (head === 'metric' && tail) return { name: 'metric', metric: decodeURIComponent(tail) };
  if (head === 'logs') return { name: 'logs' };
  return { name: 'dashboard' };
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'metric':
      return `#/metric/${encodeURIComponent(route.metric)}`;
    case 'logs':
      return '#/logs';
    default:
      return '#/';
  }
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next);
    if (window.location.hash === hash) {
      // Same target: still scroll up, as the user asked to "go" somewhere.
      window.scrollTo({ top: 0 });
      return;
    }
    window.location.hash = hash;
  }, []);

  // Landing on a sub-view should start at the top, not wherever the dashboard
  // happened to be scrolled to.
  useEffect(() => {
    if (route.name !== 'dashboard') window.scrollTo({ top: 0 });
  }, [route.name]);

  return [route, navigate];
}
