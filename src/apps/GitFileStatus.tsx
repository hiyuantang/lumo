// SPDX-License-Identifier: AGPL-3.0-only
export function GitFileStatus({ status }: { status: 'New' | 'Added' | 'Modified' | 'Deleted' | 'Renamed' | 'Conflict' }) {
  return <span className={`git-file-status is-${status.toLowerCase()}`} role="img" aria-label={status} title={status}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="2.5"/>
      {status === 'New' || status === 'Added' ? <path d="M5 8h6M8 5v6"/> : status === 'Deleted' ? <path d="M5 8h6"/> : status === 'Renamed' ? <path d="M4.5 8h7M8.5 5l3 3-3 3"/> : status === 'Conflict' ? <><path d="M8 4.5v4"/><circle cx="8" cy="11" r=".7" fill="currentColor" stroke="none"/></> : <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/>}
    </svg>
  </span>;
}
