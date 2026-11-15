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
          content="default-src 'none'; style-src ${assets.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';"
        />
        <link rel="stylesheet" href="${assets.css}" />
        <style id="code-palette" nonce="${nonce}"></style>
        <title>WatDatMean</title>
      </head>
      <body>
        <header>
          <div class="brand">
            <span class="logo">w?</span>
            <div>
              <strong>
                watdatmean
                <span class="accent">.</span>
              </strong>
              <small>A little clarity goes a long way.</small>
            </div>
          </div>
          <div class="header-actions">
            <button
              id="history-toggle"
              class="quiet"
              aria-expanded="false"
              aria-controls="history-panel"
            >
              History
            </button>
            <button
              id="bookmarks-toggle"
              class="quiet"
              aria-expanded="false"
              aria-controls="bookmarks-panel"
            >
              Bookmarks
            </button>
            <button id="configure" class="quiet">Connect provider</button>
          </div>
        </header>
        <p id="bookmark-feedback" class="notice" role="status" hidden></p>
        <section id="history-panel" class="history-panel" aria-labelledby="history-heading" hidden>
          <div class="section-heading">
            <h2 id="history-heading">Recent entries</h2>
            <button id="history-close" class="quiet">Back to current code</button>
          </div>
          <p class="muted">
            Saved on this device for this project. Up to 30 recent entries; repeats update the same
            entry. Reading history uses 0 AI tokens.
          </p>
          <label class="history-save">
            <input id="history-enabled" type="checkbox" checked />
            Save completed lessons
          </label>
          <div id="history-status" class="muted" role="status"></div>
          <div id="history-browser">
            <label for="history-search">Find an entry</label>
            <input
              id="history-search"
              type="search"
              placeholder="Search code, file, language or explanation"
            />
            <ul id="history-list" class="history-list" aria-label="Saved entries"></ul>
            <p id="history-empty" class="muted">Loading saved entries…</p>
            <button id="history-clear" class="quiet" disabled>Clear history</button>
            <div id="history-confirm" class="notice" hidden>
              <p>Remove all saved entries for this project?</p>
              <button id="history-confirm-clear" class="secondary">Clear all entries</button>
              <button id="history-keep" class="quiet">Keep history</button>
            </div>
          </div>
          <div id="history-detail" hidden></div>
        </section>
        <section
          id="bookmarks-panel"
          class="history-panel"
          aria-labelledby="bookmarks-heading"
          hidden
        >
          <div class="section-heading">
            <h2 id="bookmarks-heading">Bookmarks</h2>
            <button id="bookmarks-close" class="quiet">Back to current code</button>
          </div>
          <p class="muted">
            Saved sources for this project. Kept until you remove them, even after history expires.
            No AI tokens.
          </p>
          <label for="bookmarks-search">Find a bookmark</label>
          <input
            id="bookmarks-search"
            type="search"
            placeholder="Search title, topic, version or website"
          />
          <label for="bookmarks-filter">Resource type</label>
          <select id="bookmarks-filter">
            <option value="all">All resources</option>
            <option value="docs">Docs</option>
            <option value="videos">Videos</option>
            <option value="code">Code</option>
            <option value="books">Books / PDFs</option>
          </select>
          <p id="bookmarks-status" class="muted" role="status"></p>
          <ul id="bookmarks-list" class="history-list" aria-label="Bookmarked sources"></ul>
        </section>
        <main id="learning-panel">
          <div class="eyebrow">
            YOUR CODE, UNDERSTOOD
            <span class="badge" id="language">TYPESCRIPT</span>
          </div>
          <h1>Make it make sense.</h1>
          <p class="intro">
            Start with the small pieces. See how they fit. Make your next change with context.
          </p>
          <section class="source-card">
            <div class="source-heading">
              <span id="location">Select code in your editor</span>
              <button id="refresh" class="quiet" title="Load the current code from your file">
                ↻ Use latest code
              </button>
            </div>
            <div class="numbered-code" id="source-frame">
              <div class="line-gutter" role="group" aria-label="Original code line numbers">
                <div id="source-lines" class="line-numbers"></div>
              </div>
              <pre id="source-scroll"><code id="source"></code></pre>
            </div>
          </section>
          <div id="stale" class="notice" hidden>
            Your file changed. Choose “Use latest code” to continue with the updated version.
          </div>
          <section id="syntax-section" hidden>
            <div class="section-heading">
              <h2>The small pieces</h2>
              <span class="pill">Instant · 0 tokens</span>
            </div>
            <p class="muted">
              Select an outlined piece to unpack it. These explanations work offline.
            </p>
            <div class="numbered-code parts-frame" id="parts-frame">
              <div class="line-gutter" role="group" aria-label="Small pieces line numbers">
                <div id="parts-lines" class="line-numbers"></div>
              </div>
              <pre
                id="parts-scroll"
                class="parts-code"
              ><code id="parts" class="parts" aria-label="Code pieces to explore"></code></pre>
            </div>
            <div
              id="part-detail"
              class="part-detail"
              aria-live="polite"
              aria-atomic="true"
              hidden
            ></div>
          </section>
          <nav class="tabs" aria-label="Learning views">
            <button class="tab active" data-tab="understand" aria-pressed="true">Understand</button>
            <button class="tab" data-tab="examples" aria-pressed="false">Another example</button>
            <button class="tab" data-tab="impact" aria-pressed="false">Try it yourself</button>
          </nav>
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
          <section id="understand" class="view">
            <div class="prompt-card">
              <span class="step">01 / UNDERSTAND</span>
              <h2>A clearer picture, one idea at a time.</h2>
              <p>
                One compact walkthrough of what happens and why, with the important details
                explained in plain language.
              </p>
              <button id="explain" class="primary ai-action">
                Explain this code
                <span>↗</span>
              </button>
              <button id="walkthrough" class="secondary ai-action">More detail · AI ↗</button>
              <div class="web-option">
                <label class="web-switch">
                  <input
                    id="web-research"
                    type="checkbox"
                    role="switch"
                    aria-controls="web-options"
                  />
                  Add web resources
                </label>
                <div id="web-options" hidden>
                  <p class="muted">
                    Adds a separate lookup after Explain or More detail. Only the public topic,
                    version and resource choice go to Bing (DuckDuckGo fallback). Short excerpts
                    then go to your AI provider: one request, bounded input and up to 900 output
                    tokens.
                  </p>
                  <label for="web-topic">Public search topic</label>
                  <input
                    id="web-topic"
                    type="text"
                    maxlength="200"
                    placeholder="For example: Java constructor order"
                  />
                  <div class="web-controls">
                    <div>
                      <label for="web-version">Target version (optional)</label>
                      <input
                        id="web-version"
                        type="text"
                        maxlength="120"
                        list="web-version-hints"
                        placeholder="For example: Java 17 or React 18"
                      />
                      <datalist id="web-version-hints"></datalist>
                    </div>
                    <div>
                      <label for="web-filter">Resources</label>
                      <select id="web-filter">
                        <option value="all">All resources</option>
                        <option value="docs">Docs</option>
                        <option value="videos">Videos</option>
                        <option value="code">Code</option>
                        <option value="books">Books / PDFs</option>
                      </select>
                    </div>
                  </div>
                  <small id="web-version-note" class="muted">
                    Version unknown. Enter a target if needed.
                  </small>
                  <p id="web-model" class="muted"></p>
                  <button id="web-find" class="secondary work-action">
                    Find web resources · AI ↗
                  </button>
                </div>
              </div>
              <p class="muted">
                Ask for more detail when you need it. Choose “In this project” to include clues
                outside your selection; missing values stay unknown.
              </p>
            </div>
            <div id="explanation"></div>
            <div id="web-status" class="muted" role="status"></div>
            <div id="web-result"></div>
          </section>
          <section id="examples" class="view" hidden>
            <div class="prompt-card">
              <span class="step">02 / CONNECT THE DOTS</span>
              <h2>Same idea. A different situation.</h2>
              <p>Explore a fresh example so you can use the pattern beyond this file.</p>
              <button id="example" class="primary ai-action">
                Show another example
                <span>↗</span>
              </button>
            </div>
            <div id="example-result"></div>
          </section>
          <section id="impact" class="view" hidden>
            <div class="prompt-card">
              <span class="step">03 / TRY IT YOURSELF</span>
              <h2>What happens if you change this?</h2>
              <p>
                Tinker with your version below, then compare it with your file. Keep changing it and
                trying again. Your file changes only when you choose “Use this code”.
              </p>
              <label for="replacement">Your version</label>
              <div class="code-input" id="code-input">
                <div class="line-gutter" role="group" aria-label="Your version line numbers">
                  <div id="draft-lines" class="line-numbers"></div>
                </div>
                <div class="code-edit">
                  <pre class="draft-colors" aria-hidden="true"><code id="draft-colors"></code></pre>
                  <textarea
                    id="replacement"
                    spellcheck="false"
                    rows="8"
                    wrap="off"
                    aria-label="Your version of the code"
                  ></textarea>
                </div>
              </div>
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
          <div id="progress" class="notice" role="status" hidden>
            <span class="spinner"></span>
            <span>Connecting the dots…</span>
            <button id="cancel" class="quiet">Cancel</button>
          </div>
          <div id="error" class="error" role="alert" hidden></div>
          <footer>
            <span id="provider-status">Local explanations are ready.</span>
            <p>
              AI runs only when you ask. “Just this code” sends your selection; project and change
              explanations also send nearby code and up to 12 reference snippets. AI answers may be
              wrong—check the code and tests.
            </p>
          </footer>
        </main>
        <script
          nonce="${nonce}"
          src="${assets.script.replace(/panel\.js$/, 'code-colors.js')}"
        ></script>
        <script nonce="${nonce}" src="${assets.script}"></script>
      </body>
    </html>
  `;
}
