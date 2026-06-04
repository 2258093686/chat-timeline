/**
 * Reconstructs a chat session object from VS Code's newer append-log `.jsonl`
 * format into the same shape the v3 parser already understands.
 *
 * Each line is a JSON record:
 *   - `{ kind: 0, v: <full session snapshot> }`         — base state
 *   - `{ kind: 1, k: [path...], v: <value> }`           — set scalar at path
 *   - `{ kind: 2, k: [path...], v: <array of items> }`  — append items to the
 *                                                          array at path
 *
 * Unknown kinds and malformed lines are ignored (fault tolerance).
 */

type PathKey = string | number;

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Navigate to the container holding the final path segment, creating gaps. */
function resolveContainer(
  root: Record<string, unknown>,
  path: PathKey[]
): { container: Record<string, unknown> | unknown[]; last: PathKey } | undefined {
  if (path.length === 0) {
    return undefined;
  }
  let node: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (!isObj(node) && !Array.isArray(node)) {
      return undefined;
    }
    const key = path[i];
    node = (node as Record<PathKey, unknown>)[key];
  }
  if (!isObj(node) && !Array.isArray(node)) {
    return undefined;
  }
  return { container: node as Record<string, unknown> | unknown[], last: path[path.length - 1] };
}

function setAtPath(root: Record<string, unknown>, path: PathKey[], value: unknown): void {
  const target = resolveContainer(root, path);
  if (!target) {
    return;
  }
  (target.container as Record<PathKey, unknown>)[target.last] = value;
}

function appendAtPath(root: Record<string, unknown>, path: PathKey[], value: unknown): void {
  const target = resolveContainer(root, path);
  if (!target) {
    return;
  }
  const existing = (target.container as Record<PathKey, unknown>)[target.last];
  if (Array.isArray(existing) && Array.isArray(value)) {
    existing.push(...value);
  } else if (Array.isArray(value)) {
    (target.container as Record<PathKey, unknown>)[target.last] = [...value];
  } else {
    // Not an array payload: fall back to a plain set.
    (target.container as Record<PathKey, unknown>)[target.last] = value;
  }
}

/**
 * Parse a `.jsonl` session log and return the reconstructed session object,
 * or `undefined` if no usable snapshot was found.
 */
export function reconstructJsonl(text: string): unknown {
  const lines = text.split(/\r?\n/);
  let session: Record<string, unknown> | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let rec: unknown;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed line
    }
    if (!isObj(rec)) {
      continue;
    }
    const kind = rec.kind;

    if (kind === 0) {
      // Base snapshot; if several appear, the latest wins.
      if (isObj(rec.v)) {
        session = rec.v as Record<string, unknown>;
      }
      continue;
    }

    if (!session) {
      continue; // deltas before any snapshot are meaningless
    }
    if (!Array.isArray(rec.k)) {
      continue;
    }
    const path = rec.k as PathKey[];

    if (kind === 1) {
      setAtPath(session, path, rec.v);
    } else if (kind === 2) {
      appendAtPath(session, path, rec.v);
    }
    // other kinds: ignored
  }

  return session;
}
