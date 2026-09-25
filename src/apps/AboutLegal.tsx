// SPDX-License-Identifier: AGPL-3.0-only
export function AboutLegal() {
  return (
    <div data-testid="settings-about">
      <header className="settings-heading">
        <h2>About</h2>
        <p>Lumio OS · A web-native desktop for your server.</p>
      </header>
      <h3 className="settings-section-title">Legal</h3>
      <section className="settings-group" aria-label="Legal">
        <div className="settings-row">
          <div>
            <h3>Source Code</h3>
            <p>
              <a href="https://github.com/hiyuantang/lumio-os" target="_blank" rel="noreferrer" data-testid="legal-source">
                View the Lumio OS repository
              </a>
            </p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <h3>License</h3>
            <p>
              <a href="https://github.com/hiyuantang/lumio-os/blob/main/LICENSE" target="_blank" rel="noreferrer" data-testid="legal-license">
                GNU Affero General Public License v3 only (AGPL-3.0-only)
              </a>
            </p>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <h3>No Warranty</h3>
            <p>
              Lumio OS is provided without warranty, including implied warranties of merchantability
              or fitness for a particular purpose. See AGPL-3.0 sections 15 and 16 for the warranty
              disclaimer and limitation of liability.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
