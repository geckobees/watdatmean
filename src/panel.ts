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
          content="default-src 'none'; style-src ${assets.cspSource}; script-src 'nonce-${nonce}';"
        />
        <link rel="stylesheet" href="${assets.css}" />
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
          <button id="configure" class="quiet">Connect provider</button>
        </header>
        <main>
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
            <pre><code id="source"></code></pre>
          </section>
          <div id="stale" class="notice" hidden>
            Your file changed. Choose “Use latest code” to continue with the updated version.
          </div>
          <section id="syntax-section" hidden>
            <div class="section-heading">
              <h2>The small pieces</h2>
              <span class="pill">Instant · 0 tokens</span>
            </div>
            <p class="muted">Select a piece to unpack it. These explanations work offline.</p>
            <div id="parts" class="parts"></div>
            <div id="part-detail" class="part-detail" hidden></div>
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
              <p class="muted">
                Ask for more detail when you need it. Choose “In this project” to include clues
                outside your selection; missing values stay unknown.
              </p>
            </div>
            <div id="explanation"></div>
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
        <script nonce="${nonce}" src="${assets.script}"></script>
      </body>
    </html>
  `;
}
