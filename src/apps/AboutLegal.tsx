// SPDX-License-Identifier: AGPL-3.0-only
export function AboutLegal() {
  return (
    <div data-testid="settings-about">
      <header className="settings-heading">
        <h2>About</h2>
        <p>Lumo</p>
      </header>
      <h3 className="settings-section-title">Legal</h3>
      <section className="settings-group" aria-label="Legal">
        <div className="settings-row">
          <div>
            <h3>Source Code</h3>
            <p>
              <a href="https://github.com/hiyuantang/lumo" target="_blank" rel="noreferrer" data-testid="legal-source">
                Lumo on GitHub
              </a>
            </p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <h3>License</h3>
            <p>
              <a href="https://github.com/hiyuantang/lumo/blob/main/LICENSE" target="_blank" rel="noreferrer" data-testid="legal-license">
                AGPL-3.0-only
              </a>
            </p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <h3>No Warranty</h3>
            <p>
              Provided without warranty. See AGPL-3.0 sections 15 and 16.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
