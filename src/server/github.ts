/**
 * Minimal GitHub Contents API client.
 *
 * The token lives only in this module's process memory. It is never sent to a
 * browser, never included in a state broadcast and never written to a log line.
 */

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface GitHubCommitResult {
  htmlUrl: string;
  path: string;
  commitSha: string;
}

export class GitHubConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `GitHub saving is not configured on the server. Missing: ${missing.join(', ')}. ` +
        'Set these environment variables and restart, or use Download JSON instead.',
    );
    this.name = 'GitHubConfigError';
    this.missing = missing;
  }
}

export class GitHubRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubRequestError';
    this.status = status;
  }
}

export function readGitHubConfig(env: NodeJS.ProcessEnv = process.env): GitHubConfig | null {
  const token = (env.GITHUB_TOKEN ?? '').trim();
  const owner = (env.GITHUB_OWNER ?? '').trim();
  const repo = (env.GITHUB_REPO ?? '').trim();
  const branch = (env.GITHUB_BRANCH ?? '').trim() || 'main';
  if (!token || !owner || !repo) return null;
  return { token, owner, repo, branch };
}

export function missingGitHubSettings(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!(env.GITHUB_TOKEN ?? '').trim()) missing.push('GITHUB_TOKEN');
  if (!(env.GITHUB_OWNER ?? '').trim()) missing.push('GITHUB_OWNER');
  if (!(env.GITHUB_REPO ?? '').trim()) missing.push('GITHUB_REPO');
  return missing;
}

export function isGitHubConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return missingGitHubSettings(env).length === 0;
}

/** Strips anything token-shaped out of text before it reaches a log or a user. */
export function redact(message: string, token?: string): string {
  let safe = message;
  if (token && token.length > 4) safe = safe.split(token).join('***');
  return safe
    .replace(/gh[pousr]_[A-Za-z0-9]{10,}/g, '***')
    .replace(/github_pat_[A-Za-z0-9_]{10,}/g, '***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
}

export type FetchLike = (input: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

interface CommitOptions {
  config: GitHubConfig;
  path: string;
  content: string;
  message: string;
  fetchImpl?: FetchLike;
}

/**
 * Creates or updates a file through the Contents API and resolves only after
 * GitHub confirms the commit.
 */
export async function commitFile(options: CommitOptions): Promise<GitHubCommitResult> {
  const { config, path, content, message } = options;
  const fetchImpl = (options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike));
  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available in this runtime.');
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(
    config.repo,
  )}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'flow-factory-retro',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // A retro file name includes minutes and the room code, so a collision means
  // the same room saved twice in the same minute: update that file in place.
  let existingSha: string | undefined;
  const existing = await fetchImpl(`${url}?ref=${encodeURIComponent(config.branch)}`, {
    method: 'GET',
    headers,
  });
  if (existing.ok) {
    const body = (await existing.json()) as { sha?: string };
    if (body && typeof body.sha === 'string') existingSha = body.sha;
  } else if (existing.status !== 404) {
    throw new GitHubRequestError(
      existing.status,
      redact(await safeMessage(existing), config.token),
    );
  }

  const response = await fetchImpl(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: config.branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });

  if (!response.ok) {
    throw new GitHubRequestError(response.status, redact(await safeMessage(response), config.token));
  }

  const payload = (await response.json()) as {
    content?: { html_url?: string; path?: string };
    commit?: { sha?: string; html_url?: string };
  };

  const htmlUrl = payload.content?.html_url ?? payload.commit?.html_url;
  const commitSha = payload.commit?.sha;
  if (!htmlUrl || !commitSha) {
    throw new GitHubRequestError(response.status, 'GitHub accepted the request but returned no commit.');
  }

  return { htmlUrl, path: payload.content?.path ?? path, commitSha };
}

async function safeMessage(response: { status: number; json: () => Promise<unknown>; text: () => Promise<string> }): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    if (body && typeof body.message === 'string') {
      return `GitHub responded ${response.status}: ${body.message}`;
    }
  } catch {
    /* fall through to text */
  }
  try {
    const text = await response.text();
    return `GitHub responded ${response.status}: ${text.slice(0, 200)}`;
  } catch {
    return `GitHub responded ${response.status}.`;
  }
}

export function describeGitHubError(error: unknown, token?: string): string {
  if (error instanceof GitHubConfigError) return error.message;
  if (error instanceof GitHubRequestError) {
    if (error.status === 401 || error.status === 403) {
      return 'GitHub rejected the credentials. Check that the token is valid and has Contents: Read and write on this repository.';
    }
    if (error.status === 404) {
      return 'GitHub could not find that repository or branch. Check GITHUB_OWNER, GITHUB_REPO and GITHUB_BRANCH.';
    }
    if (error.status === 409 || error.status === 422) {
      return 'GitHub refused the commit, usually because the branch does not exist yet. Push an initial commit to the branch first.';
    }
    return redact(error.message, token);
  }
  if (error instanceof Error) return redact(error.message, token);
  return 'The save failed for an unknown reason.';
}
