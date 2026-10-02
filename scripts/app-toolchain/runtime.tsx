// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import * as Client from 'react-dom/client';
import * as JSXRuntime from 'react/jsx-runtime';
export const react = React;
export const client = Client;
export const jsx = JSXRuntime;
function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button type="button" {...props}/>; }
function Field({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  if (props.type && props.type !== 'text') throw new Error('Field supports text inputs.');
  const generated = React.useId(); const id = props.id ?? generated;
  return <div className="lumo-field"><label htmlFor={id}>{label}</label><input {...props} id={id}/></div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="lumo-panel"><h2>{title}</h2>{children}</section>; }
function Status({ children }: { children: React.ReactNode }) { return <p role="status">{children}</p>; }
export const ui = { Button, Field, Panel, Status };
