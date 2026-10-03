// SPDX-License-Identifier: AGPL-3.0-only
import React, { useState } from 'react';
export default function App() {
  const [count, setCount] = useState(0);
  return <section className="app plugin-__APP__"><header><h1>{__TITLE__}</h1></header><p role="status">Count: {count}</p><div className="actions"><button className="btn" onClick={() => setCount(value => value + 1)}>Add one</button><button className="btn" onClick={() => setCount(0)}>Reset</button></div></section>;
}
