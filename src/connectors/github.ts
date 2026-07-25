import type { Connector } from './sdk.js';
import type { Signal } from '../signals/registry.js';
import { fixtureConnector } from './fixture.js';

/**
 * GitHub connector. Default: fixture replay. If GITHUB_REPO is set (owner/repo),
 * pulls real public stargazers via the REST API — official API only, no scraping.
 */
export function githubConnector(fixtureFile: string, liveRepo?: string): Connector {
  if (!liveRepo) return { ...fixtureConnector('github', fixtureFile), name: 'github' };
  return {
    name: 'github',
    async fetch(): Promise<Signal[]> {
      const res = await fetch(`https://api.github.com/repos/${liveRepo}/stargazers?per_page=50`, {
        headers: { accept: 'application/vnd.github.star+json', 'user-agent': 'gtm-intelligence-engine' },
      });
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{ starred_at: string; user: { login: string } }>;
      return rows.map((r) => ({
        signalType: 'repo_star' as const,
        externalId: `star:${r.user.login}`,
        observedAt: r.starred_at,
        actor: { handle: r.user.login },
        props: { repo: liveRepo },
        consentBasis: 'legitimate_interest' as const,
      }));
    },
  };
}
