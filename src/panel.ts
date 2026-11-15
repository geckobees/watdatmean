export function panelHtml(
  assets: { cspSource: string; css: string; script: string },
  nonce: string,
): string {
  return /* HTML */ `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${assets.cspSource}; font-src ${assets.cspSource}; script-src 'nonce-${nonce}';"
        />
        <link rel="stylesheet" href="${assets.css}" />
        <title>WatDatMean</title>
      </head>
      <body>
        <header class="app-header">
          <div class="brand">
            <span class="brand-mark" aria-hidden="true">{}</span>
            <strong>watdatmean</strong>
          </div>
          <button
            id="sound-toggle"
            class="text-control"
            aria-pressed="false"
            title="Turn on interaction sounds"
          >
            Sound off
          </button>
        </header>
        <main>
          <section class="workbench" aria-label="Selected code">
            <div class="pieces-intro">
              <h1 id="pieces-heading">Code</h1>
            </div>
            <div class="source-heading">
              <div class="file-location">
                <span class="file-icon" aria-hidden="true">ts</span>
                <span id="location">Select code in your editor</span>
              </div>
              <button id="refresh" class="quiet" title="Load the current code from your file">
                <span aria-hidden="true">↻</span>
                Use latest code
              </button>
            </div>
            <div id="stale" class="notice" hidden>
              Your file changed. Choose “Use latest code” to continue with the updated version.
            </div>
            <section id="syntax-section" hidden aria-labelledby="pieces-heading">
              <pre
                class="parts-code"
              ><code id="parts" class="parts" aria-label="Code pieces to explore"></code></pre>
              <div class="piece-reading">
                <div id="piece-placeholder" class="piece-placeholder">
                  <div>
                    <p>Select a word or symbol</p>
                    <span>Its explanation will appear here.</span>
                  </div>
                </div>
                <div
                  id="part-detail"
                  class="part-detail"
                  aria-live="polite"
                  aria-atomic="true"
                  hidden
                ></div>
                <div id="piece-navigation" class="piece-navigation" hidden>
                  <span id="piece-position" class="muted"></span>
                  <div class="piece-navigation-actions">
                    <button id="previous-piece" class="icon-button" aria-label="Previous piece">
                      ←
                    </button>
                    <button id="next-piece" class="icon-button" aria-label="Next piece">→</button>
                  </div>
                </div>
              </div>
            </section>
            <details id="source-disclosure" class="source-disclosure">
              <summary>Original code</summary>
              <pre><code id="source"></code></pre>
            </details>
          </section>
          <nav class="tabs" aria-label="Learning views" data-active="understand">
            <button class="tab active" data-tab="understand" aria-pressed="true">
              Explanation
            </button>
            <button class="tab" data-tab="examples" aria-pressed="false">Example</button>
            <button class="tab" data-tab="impact" aria-pressed="false">Edit code</button>
          </nav>
          <details class="explanation-settings">
            <summary aria-label="Explanation settings">
              <span id="settings-summary">Learning the basics · Just this code</span>
            </summary>
            <div class="preferences">
              <label>
                Context
                <select id="mode">
                  <option value="standalone">Just this code</option>
                  <option value="project">In this project</option>
                </select>
              </label>
              <label>
                Guidance
                <select id="audience">
                  <option value="beginner">Learning the basics</option>
                  <option value="experienced">Getting up to speed</option>
                </select>
              </label>
            </div>
          </details>
          <div id="progress" class="notice" role="status" hidden>
            <span class="spinner" aria-hidden="true"></span>
            <span>Generating explanation…</span>
            <button id="cancel" class="quiet">Cancel</button>
          </div>
          <div id="error" class="error" role="alert" hidden></div>
          <section id="understand" class="view">
            <div class="prompt-card">
              <h2>Explanation</h2>
              <p>Explain the selected code and its concepts.</p>
              <button id="explain" class="primary ai-action">
                Explain this code
                <span aria-hidden="true">↗</span>
              </button>
              <span class="action-note">With your AI provider</span>
            </div>
            <div id="explanation"></div>
          </section>
          <section id="examples" class="view" hidden>
            <div class="prompt-card">
              <h2>Example</h2>
              <p>Generate another example using the same concepts.</p>
              <button id="example" class="primary ai-action">
                Show another example
                <span aria-hidden="true">↗</span>
              </button>
              <span class="action-note">With your AI provider</span>
            </div>
            <div id="example-result"></div>
          </section>
          <section id="impact" class="view" hidden>
            <div class="prompt-card">
              <h2>Edit code</h2>
              <p>
                Edit the code below, then compare it with your file. Changes are applied only when
                you choose “Use this code”.
              </p>
              <label for="replacement">Your version</label>
              <textarea
                id="replacement"
                spellcheck="false"
                rows="8"
                aria-label="Your version of the code"
              ></textarea>
              <div class="actions">
                <button id="preview" class="secondary work-action">See what changes</button>
                <button id="analyze" class="primary ai-action">Explain the change · AI ↗</button>
                <button id="reset" class="quiet work-action">Start over</button>
              </div>
              <p class="muted">
                Comparing checks syntax and shows the difference. It does not run your code.
              </p>
              <div id="preview-status" role="status"></div>
              <button id="apply" class="secondary" disabled>Use this code</button>
            </div>
            <div id="impact-result"></div>
          </section>
          <section id="evidence-section" hidden>
            <div class="section-heading">
              <h2>Supporting code</h2>
              <span class="pill">Language service</span>
            </div>
            <p id="evidence-note" class="muted"></p>
            <div id="evidence"></div>
          </section>
          <footer>
            <div class="footer-heading">
              <span id="provider-status">Local explanations are ready.</span>
              <button id="configure" class="quiet">Connect provider</button>
            </div>
            <div class="footer-options">
              <details class="privacy-note">
                <summary>About AI &amp; your code</summary>
                <p>
                  AI runs only when you ask. “Just this code” sends your selection; project and
                  change explanations also send nearby code and up to 12 reference snippets. AI
                  answers may be wrong—check the code and tests.
                </p>
              </details>
              <button id="motion-toggle" class="quiet" aria-pressed="true">Motion on</button>
            </div>
          </footer>
        </main>
        <script nonce="${nonce}" src="${assets.script}"></script>
      </body>
    </html>
  `;
}
