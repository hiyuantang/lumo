// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo } from 'react';

export function GitDiffView({ text }: { text: string }) {
  const rows = useMemo(() => {
    let oldLine = 0; let newLine = 0; let inHunk = false;
    return text.split('\n').slice(0, 6000).map((line) => {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      let before: number | undefined; let after: number | undefined; let kind = '';
      if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true; kind = 'hunk'; }
      else if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++')) inHunk = false;
      else if (line.startsWith('New file: ')) { inHunk = true; newLine = 1; }
      else if (inHunk && line.startsWith('+')) { after = newLine++; kind = 'addition'; }
      else if (inHunk && line.startsWith('-')) { before = oldLine++; kind = 'deletion'; }
      else if (inHunk && line.startsWith(' ')) { before = oldLine++; after = newLine++; }
      return { line, before, after, kind };
    });
  }, [text]);
  return <><pre>{rows.map((row, index) => <span key={index} className={row.kind}><i aria-hidden="true">{row.before ?? ''}</i><i aria-hidden="true">{row.after ?? ''}</i><code>{row.line || ' '}</code></span>)}</pre>{text.split('\n').length > 6000 && <p role="status">Showing the first 6,000 lines. Open Terminal for the complete diff.</p>}</>;
}
