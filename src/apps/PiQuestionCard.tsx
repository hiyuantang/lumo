// SPDX-License-Identifier: AGPL-3.0-only
import { useId, useRef, useState } from 'react';
import type { PiAnswer, PiQuestion } from '../api/pi';

export function PiQuestionCard({ question, onAnswer, compact = false }: { question: PiQuestion; onAnswer: (answer: PiAnswer, requestId: string) => Promise<void>; compact?: boolean }) {
  const id = useId();
  const [choice, setChoice] = useState<string | null>(null);
  const [text, setText] = useState(question.prefill ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ body: string; id: string }>();
  const lock = useRef(false);
  const approval = question.method === 'confirm';
  const options = approval ? [] : question.options ?? [];
  const answer = text.trim() || choice;
  async function submit(cancelled = false, confirmed?: boolean) {
    if (lock.current || (!cancelled && confirmed == null && answer == null)) return;
    const response: PiAnswer = { questionId: question.id, ...(cancelled ? { cancelled: true as const } : approval ? { confirmed: confirmed === true } : { value: answer! }) };
    const body = JSON.stringify(response);
    if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() };
    lock.current = true; setPending(true); setError('');
    try { await onAnswer(response, attempt.current.id); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not send your answer. Try again.'); }
    finally { lock.current = false; setPending(false); }
  }
  const actions = <div className="pi-question-actions">{approval ? <><button className="btn btn-ghost" type="button" disabled={pending} onClick={() => void submit(false, false)}>Reject</button><button className="btn btn-primary" type="button" disabled={pending} onClick={() => void submit(false, true)}>{pending ? 'Sending…' : 'Approve'}</button></> : <><button className="btn btn-ghost" type="button" disabled={pending} onClick={() => void submit(true)}>Cancel</button><button className="btn btn-primary" type="submit" disabled={pending || !answer}>{pending ? 'Sending…' : 'Submit'}</button></>}</div>;
  return <form className={`pi-question${compact ? ' pi-question-compact' : ''}`} data-testid="pi-question" aria-labelledby={`${id}-title`} aria-busy={pending} onSubmit={(event) => { event.preventDefault(); if (!approval) void submit(); }}>
    {!compact && <span className="pi-question-caption">{approval ? 'Approval requested' : 'Your input'}</span>}
    <div className="pi-question-heading"><h3 id={`${id}-title`}>{question.title}</h3>{compact && actions}</div>
    {question.message && (approval ? <pre className="pi-approval-details" tabIndex={0} aria-label="Proposed action">{question.message}</pre> : <p>{question.message}</p>)}
    {options.length > 0 && <div className="pi-question-options" role="group" aria-label="Suggested answers">{options.map((option, index) => <button key={index} type="button" className="btn" aria-pressed={choice === option && !text.trim()} disabled={pending} onClick={() => { setChoice(option); setText(''); }}>{option}</button>)}</div>}
    {question.method !== 'confirm' && <textarea className="input" aria-label={options.length ? 'Your own answer' : 'Your answer'} placeholder={question.placeholder || (options.length ? 'Or write your own answer…' : 'Your answer…')} value={text} maxLength={10000} disabled={pending} rows={2} onChange={(event) => { setText(event.target.value); setChoice(null); }}/>}
    {error && <p className="pi-question-error" role="alert">{error}</p>}
    {!compact && actions}
  </form>;
}
