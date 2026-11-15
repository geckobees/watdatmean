/* All code and model output is rendered as text, never as HTML. */
(() => {
  const host = window.watdatmeanHost || acquireVsCodeApi();
  const colors = window.watdatmeanColors(host);
  const $ = (id) => document.getElementById(id);
  const post = (type, extra = {}) => host.postMessage({ type, ...extra });
  let busy = false;
  let stale = false;
  let tab = 'understand';
  let evidence = [];
  let evidenceNote = '';
  let canApply = false;
  let originalCode = '';
  let sourceLanguage = 'TypeScript';
  let pendingWeb;
  let webLessonReady = false;
  let webRunning = false;
  let versionEdited = false;
  let versionSelection;
  let bookmarks = [];
  let bookmarksLoaded = false;
  let focusAfterWork = false;
  const conceptTargets = new Map();
  let definitionId = 0;
  const saved = host.getState() || {};
  $('mode').value = saved.mode || 'standalone';
  let chosenMode = $('mode').value;
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const lines = createLineNumbers();
  const history = createHistory();
  function createHistory() {
    let state = { enabled: true, entries: [] };
    let loaded = false;
    let storageError = false;
    let selected;
    let selectedTask = 'explain';
    let scroll = 0;
    const labels = {
      explain: 'Explanation',
      walkthrough: 'More detail',
      example: 'Another example',
      impact: 'Change explanation',
    };
    const entryTitle = (entry) => entry.file.split(/[\\/]/).pop() || 'Selected code';
    const date = (entry) =>
      new Date(entry.updatedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    function open() {
      $('bookmarks-panel').hidden = true;
      $('bookmarks-toggle').setAttribute('aria-expanded', 'false');
      selected = undefined;
      $('history-confirm').hidden = true;
      scroll = window.scrollY;
      $('history-panel').hidden = false;
      $('learning-panel').hidden = true;
      $('history-toggle').setAttribute('aria-expanded', 'true');
      draw();
      $('history-search').focus();
      window.scrollTo(0, 0);
      post('historyList');
    }
    function close() {
      $('history-panel').hidden = true;
      $('learning-panel').hidden = false;
      $('history-toggle').setAttribute('aria-expanded', 'false');
      $('history-toggle').focus();
      window.scrollTo(0, scroll);
    }
    function list() {
      selected = undefined;
      draw();
      $('history-search').focus();
    }
    function draw() {
      $('history-enabled').checked = state.enabled;
      const current = state.entries.find((e) => e.id === selected);
      $('history-browser').hidden = !!current;
      $('history-detail').hidden = !current;
      if (current) {
        detail(current);
        return;
      }
      selected = undefined;
      $('history-detail').replaceChildren();
      const query = $('history-search').value.toLocaleLowerCase().trim();
      const entries = state.entries.filter((e) =>
        [
          e.file,
          e.code,
          e.language,
          ...Object.values(e.results).flatMap((r) => [
            r.lesson.title,
            r.lesson.summary,
            r.replacement || '',
          ]),
        ]
          .join('\n')
          .toLocaleLowerCase()
          .includes(query),
      );
      $('history-list').replaceChildren();
      for (const entry of entries) {
        const row = node('li', undefined, 'history-row');
        const button = node('button', undefined, 'history-entry');
        button.type = 'button';
        button.append(
          node('strong', `${entryTitle(entry)}:${entry.line}`),
          node(
            'span',
            entry.code
              .split(/\r?\n/)
              .find((s) => s.trim())
              ?.trim() || 'Selected code',
            'history-code',
          ),
          node('small', `${entry.language} · ${date(entry)}`, 'muted'),
        );
        button.title = entry.file;
        button.onclick = () => {
          selected = entry.id;
          selectedTask = 'explain';
          draw();
          $('history-detail').querySelector('button')?.focus();
        };
        const remove = node('button', '×', 'quiet history-remove');
        remove.setAttribute('aria-label', `Remove ${entryTitle(entry)}:${entry.line} from history`);
        remove.onclick = () => post('historyRemove', { id: entry.id });
        row.append(button, remove);
        $('history-list').append(row);
      }
      $('history-clear').disabled = !state.entries.length && !storageError;
      $('history-empty').hidden = !!entries.length;
      $('history-empty').textContent = !loaded
        ? storageError
          ? 'Saved entries could not be loaded.'
          : 'Loading saved entries…'
        : query
          ? 'No matching entries.'
          : state.enabled
            ? 'Your next completed explanation will appear here. Simply selecting or typing code does not add entries.'
            : 'History is paused. Turn on saving to keep future lessons.';
    }
    function detail(entry) {
      const taskNames = Object.keys(labels).filter((task) => entry.results[task]);
      if (!taskNames.includes(selectedTask)) selectedTask = taskNames[0];
      const savedResult = entry.results[selectedTask];
      const root = $('history-detail');
      root.replaceChildren();
      const back = node('button', '← All entries', 'quiet');
      back.onclick = list;
      const remove = node('button', 'Remove entry', 'quiet');
      remove.onclick = () => post('historyRemove', { id: entry.id });
      const actions = node('div', undefined, 'section-heading');
      actions.append(back, remove);
      root.append(
        actions,
        node('h3', `${entry.file}:${entry.line}`),
        node(
          'p',
          `${entry.language} · ${(savedResult.mode || entry.mode) === 'project' ? 'In this project' : 'Just this code'} · ${(savedResult.audience || entry.audience) === 'experienced' ? 'Getting up to speed' : 'Learning the basics'} · ${date(entry)}`,
          'muted',
        ),
        node(
          'p',
          'Saved snapshot. Your file may have changed; your current lesson and draft are kept separately.',
          'muted',
        ),
      );
      root.append(colors.block(entry.code, entry.language, entry.line, 'history-source'));
      const label = node('label', 'Saved view');
      label.htmlFor = 'history-view';
      const select = node('select');
      select.id = 'history-view';
      for (const task of taskNames) {
        const option = node('option', labels[task]);
        option.value = task;
        select.append(option);
      }
      select.value = selectedTask;
      select.onchange = () => {
        selectedTask = select.value;
        detail(entry);
        $('history-view').focus();
      };
      root.append(label, select);
      if (selectedTask === 'impact' && typeof savedResult.replacement === 'string') {
        root.append(node('h3', 'Your version at the time'));
        root.append(colors.block(savedResult.replacement, entry.language, entry.line));
      }
      try {
        root.append(
          renderLesson(
            savedResult.lesson,
            `SAVED ENTRY · 0 new tokens${savedResult.lesson.local ? ' · Local explanation' : ` · ${savedResult.provider} / ${savedResult.model}`}`,
            true,
            selectedTask,
            true,
            entry.language,
          ),
        );
        if (savedResult.research) root.append(renderResearch(savedResult.research, true));
      } catch {
        root.append(
          node('p', 'This saved lesson cannot be displayed. You can remove this entry.', 'muted'),
        );
      }
    }
    $('history-toggle').onclick = () => ($('history-panel').hidden ? open() : close());
    $('history-close').onclick = close;
    $('history-search').oninput = draw;
    $('history-enabled').onchange = () =>
      post('historyEnabled', { enabled: $('history-enabled').checked });
    $('history-clear').onclick = () => {
      $('history-confirm').hidden = false;
      $('history-keep').focus();
    };
    $('history-keep').onclick = () => {
      $('history-confirm').hidden = true;
      $('history-clear').focus();
    };
    $('history-confirm-clear').onclick = () => {
      $('history-confirm').hidden = true;
      post('historyClear');
    };
    $('history-panel').onkeydown = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    return {
      receive(message) {
        if (message.type === 'historyError') {
          storageError = true;
          $('history-status').textContent = message.message;
          $('history-enabled').checked = state.enabled;
          if (!$('history-panel').hidden) draw();
          return;
        }
        if (message.type !== 'history') return;
        loaded = true;
        storageError = false;
        const removedSelection =
          selected &&
          (!Array.isArray(message.entries) || !message.entries.some((e) => e?.id === selected));
        state = {
          enabled: message.enabled !== false,
          entries: Array.isArray(message.entries)
            ? message.entries
                .filter(
                  (e) =>
                    e &&
                    typeof e.id === 'string' &&
                    typeof e.code === 'string' &&
                    typeof e.file === 'string' &&
                    e.results &&
                    Object.keys(e.results).length &&
                    Object.entries(e.results).every(
                      ([t, r]) =>
                        labels[t] &&
                        typeof r?.lesson?.title === 'string' &&
                        typeof r?.lesson?.summary === 'string',
                    ),
                )
                .slice(0, 30)
            : [],
        };
        $('history-status').textContent = state.enabled
          ? ''
          : 'Saving is paused. Existing entries remain available.';
        if (!$('history-panel').hidden) {
          draw();
          if (removedSelection) $('history-search').focus();
        }
      },
    };
  }
  function matchesResource(source, filter) {
    const kind = {
      docs: 'Documentation',
      videos: 'Video',
      code: 'Source code',
      books: 'Book / PDF',
    }[filter];
    return !kind || source.kind === kind;
  }
  function sourceLink(source) {
    const a = node('a', `${source.title} ↗`, 'web-source');
    a.href = source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.onclick = (event) => {
      event.preventDefault();
      post('openWebSource', { url: source.url });
    };
    a.append(node('small', `${source.kind} · ${new URL(source.url).hostname}`, 'muted'));
    return a;
  }
  function bookmarkButton(source) {
    const button = node('button', '', 'quiet bookmark-save');
    button.dataset.url = source.url;
    function update() {
      const exists = bookmarks.some((b) => b.url === source.url);
      button.textContent = exists ? 'Saved' : 'Save';
      button.setAttribute('aria-pressed', String(exists));
      button.setAttribute(
        'aria-label',
        `${exists ? 'Remove bookmark for' : 'Bookmark'} ${source.title}`,
      );
    }
    update();
    button.onclick = () => {
      button.disabled = true;
      post(bookmarks.some((b) => b.url === source.url) ? 'bookmarkRemove' : 'bookmarkAdd', {
        url: source.url,
      });
    };
    button.refreshBookmark = () => {
      button.disabled = false;
      update();
    };
    return button;
  }
  function drawBookmarks() {
    const query = $('bookmarks-search').value.toLocaleLowerCase().trim();
    const filtered = bookmarks.filter(
      (b) =>
        matchesResource(b, $('bookmarks-filter').value) &&
        [b.title, b.topic, b.version, b.url].join(' ').toLocaleLowerCase().includes(query),
    );
    $('bookmarks-list').replaceChildren();
    for (const b of filtered) {
      const row = node('li', undefined, 'web-resource-row'),
        description = node('div');
      description.append(
        sourceLink(b),
        node(
          'small',
          [b.topic, b.version, `Retrieved ${new Date(b.checkedAt).toLocaleDateString()}`]
            .filter(Boolean)
            .join(' · '),
          'muted',
        ),
      );
      const remove = node('button', 'Remove', 'quiet');
      remove.setAttribute('aria-label', `Remove bookmark for ${b.title}`);
      remove.onclick = () => {
        remove.disabled = true;
        post('bookmarkRemove', { url: b.url });
      };
      row.append(description, remove);
      $('bookmarks-list').append(row);
    }
    $('bookmarks-status').textContent = !bookmarksLoaded
      ? 'Loading bookmarks…'
      : !bookmarks.length
        ? 'No bookmarks yet. Choose Save beside a web source.'
        : !filtered.length
          ? 'No matching bookmarks.'
          : `${bookmarks.length} of 100 saved · 0 AI tokens`;
  }
  let bookmarkScroll = 0;
  function closeBookmarks() {
    $('bookmarks-panel').hidden = true;
    $('learning-panel').hidden = false;
    $('bookmarks-toggle').setAttribute('aria-expanded', 'false');
    $('bookmarks-toggle').focus();
    window.scrollTo(0, bookmarkScroll);
  }
  $('bookmarks-toggle').onclick = () => {
    if (!$('bookmarks-panel').hidden) return closeBookmarks();
    bookmarkScroll = window.scrollY;
    $('history-panel').hidden = true;
    $('history-toggle').setAttribute('aria-expanded', 'false');
    $('learning-panel').hidden = true;
    $('bookmarks-panel').hidden = false;
    $('bookmarks-toggle').setAttribute('aria-expanded', 'true');
    drawBookmarks();
    $('bookmarks-search').focus();
    window.scrollTo(0, 0);
    post('bookmarkList');
  };
  $('bookmarks-close').onclick = closeBookmarks;
  $('bookmarks-search').oninput = drawBookmarks;
  $('bookmarks-filter').onchange = drawBookmarks;
  $('bookmarks-panel').onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBookmarks();
    }
  };
  function createLineNumbers() {
    let firstLine = 1;
    let sourceStarts = [0];
    let selectionId;
    let file = '';
    const input = $('replacement');
    const views = [
      ['source-scroll', 'source-lines', 'source-frame'],
      ['parts-scroll', 'parts-lines', 'parts-frame'],
      ['replacement', 'draft-lines', 'code-input'],
    ].map(([scroll, labels, frame]) => ({
      scroll: $(scroll),
      labels: $(labels),
      frame: $(frame),
      count: 1,
      active: -1,
      focusRow: 0,
      key: '',
    }));
    // Offsets stay in the original UTF-16 text, including CRLF source files.
    function starts(text) {
      const result = [0];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '\r') {
          if (text[i + 1] === '\n') i++;
          result.push(i + 1);
        } else if (text[i] === '\n') result.push(i + 1);
      }
      return result;
    }
    function rowAt(offset) {
      let low = 0,
        high = sourceStarts.length;
      while (low + 1 < high) {
        const mid = Math.floor((low + high) / 2);
        if (sourceStarts[mid] <= offset) low = mid;
        else high = mid;
      }
      return low;
    }
    function sync(view) {
      const { scroll, labels, frame, count, active } = view;
      if (!scroll.clientHeight) return;
      const style = getComputedStyle(scroll);
      const padding = parseFloat(style.paddingTop) || 0;
      if (!labels.firstChild) labels.append(node('span', firstLine));
      // Measure the browser's actual line box: fractional font sizes otherwise
      // accumulate rounding errors near the end of a long file.
      const height = labels.firstChild.getBoundingClientRect().height;
      if (!height) return;
      frame.style.setProperty('--code-line-height', `${height}px`);
      labels.parentElement.style.height = `${scroll.clientHeight}px`;
      const first = Math.min(
        count - 1,
        Math.max(0, Math.floor((scroll.scrollTop - padding) / height)),
      );
      const end = Math.min(count, first + Math.ceil(scroll.clientHeight / height) + 2);
      labels.style.transform = `translateY(${padding + first * height - scroll.scrollTop}px)`;
      const key = `${firstLine}:${first}:${end}:${selectionId}:${sourceStarts.length}:${stale}`;
      if (key === view.key) {
        // A textarea blur precedes a gutter click. Update classes in place so
        // moving focus cannot replace the button before its click is delivered.
        for (const span of labels.children) {
          const button = span.firstElementChild,
            row = Number(button.dataset.row);
          span.classList.toggle('active', row === active);
          button.tabIndex = row === Math.max(first, Math.min(end - 1, view.focusRow)) ? 0 : -1;
        }
        return;
      }
      view.key = key;
      const focused = labels.contains(document.activeElement)
        ? Number(document.activeElement.dataset.row)
        : undefined;
      const fragment = document.createDocumentFragment();
      for (let row = first; row < end; row++) {
        const span = node('span', undefined, row === active ? 'active' : undefined);
        const button = node('button', firstLine + row, 'line-number');
        button.type = 'button';
        button.dataset.row = String(row);
        button.tabIndex = row === Math.max(first, Math.min(end - 1, view.focusRow)) ? 0 : -1;
        button.disabled = stale || !Number.isSafeInteger(selectionId) || row >= sourceStarts.length;
        button.title = stale
          ? 'Use latest code to update line positions'
          : row >= sourceStarts.length
            ? 'This draft line is outside the original selection. Apply your changes to navigate to it.'
            : `Open ${file}:${firstLine + row}${view.scroll === input ? ' in the original file (draft changes are not applied)' : ''}`;
        // Keep the accessible name tied to its destination even when disabled;
        // the tooltip explains why navigation is currently unavailable.
        button.setAttribute('aria-label', `Open ${file}:${firstLine + row}`);
        button.onfocus = () => {
          view.focusRow = row;
          labels.querySelectorAll('button').forEach((item) => {
            item.tabIndex = item === button ? 0 : -1;
          });
        };
        button.onclick = () => {
          if (!button.disabled) post('openSourceLine', { selectionId, line: firstLine + row });
        };
        button.onkeydown = (event) => {
          const targets = {
            ArrowUp: row - 1,
            ArrowDown: row + 1,
            Home: 0,
            End: Math.min(count, sourceStarts.length) - 1,
          };
          if (!(event.key in targets) || event.altKey || event.ctrlKey || event.metaKey) return;
          event.preventDefault();
          const targetRow = Math.max(
            0,
            Math.min(Math.min(count, sourceStarts.length) - 1, targets[event.key]),
          );
          view.focusRow = targetRow;
          const top = padding + targetRow * height;
          if (top < scroll.scrollTop) scroll.scrollTop = top;
          else if (top + height > scroll.scrollTop + scroll.clientHeight)
            scroll.scrollTop = top + height - scroll.clientHeight;
          sync(view);
          labels.querySelector(`[data-row="${targetRow}"]`)?.focus({ preventScroll: true });
        };
        span.append(button);
        fragment.append(span);
      }
      labels.replaceChildren(fragment);
      if (focused !== undefined)
        labels.querySelector(`[data-row="${focused}"]`)?.focus({ preventScroll: true });
    }
    function count(view, value) {
      view.count = value;
      view.frame.style.setProperty('--code-line-count', String(value));
      view.frame.style.setProperty(
        '--gutter-digits',
        String(Math.max(3, String(firstLine + value - 1).length)),
      );
      sync(view);
    }
    function caret() {
      views[2].active =
        document.activeElement === input
          ? starts(input.value.slice(0, input.selectionStart)).length - 1
          : -1;
      sync(views[2]);
    }
    function draft() {
      count(views[2], starts(input.value).length);
      caret();
    }
    // Resize callbacks must not change their observed layout in the same delivery
    // cycle; older IntelliJ JCEF otherwise reports a ResizeObserver loop.
    let resizeFrame = 0;
    const resized = () => {
      if (!resizeFrame)
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = 0;
          views.forEach(sync);
        });
    };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(resized) : undefined;
    for (const view of views) {
      view.scroll.addEventListener('scroll', () => sync(view), { passive: true });
      resize?.observe(view.scroll);
      resize?.observe(view.labels);
    }
    window.addEventListener('resize', resized);
    input.addEventListener('input', draft);
    for (const event of ['select', 'keyup', 'click', 'focus', 'blur'])
      input.addEventListener(event, caret);
    return {
      selection(message) {
        const tabSize =
          Number.isInteger(message.tabSize) && message.tabSize >= 1 && message.tabSize <= 32
            ? message.tabSize
            : 4;
        document.documentElement.style.setProperty('--code-tab-size', String(tabSize));
        selectionId = message.selectionId;
        file = message.file;
        firstLine = Number.isSafeInteger(message.line) && message.line > 0 ? message.line : 1;
        sourceStarts = starts(message.code);
        views[2].focusRow = 0;
        for (const view of views.slice(0, 2)) {
          view.active = -1;
          view.focusRow = 0;
          view.scroll.scrollTop = 0;
          view.scroll.scrollLeft = 0;
          count(view, sourceStarts.length);
        }
        draft();
      },
      draft,
      refresh() {
        views.forEach(sync);
      },
      location(start, end) {
        const first = firstLine + rowAt(start),
          last = firstLine + rowAt(end - 1);
        return first === last ? String(first) : `${first}–${last}`;
      },
      select(offset) {
        for (const view of views.slice(0, 2)) {
          view.active = rowAt(offset);
          sync(view);
        }
      },
    };
  }
  function addConceptExpansion(parent, concept, label = 'Explain this concept ↗') {
    const target = node('div', undefined, 'concept-result');
    target.hidden = true;
    const more = node('button', label, 'secondary ai-action');
    more.type = 'button';
    more.disabled = busy || stale;
    more.onclick = () => {
      conceptTargets.set(concept.term, target);
      request('concept', { concept: concept.term });
    };
    parent.append(more, target);
  }
  function appendConceptText(parent, text, concepts, nested = false) {
    const terms = concepts
      .filter((concept) => concept.term && concept.explanation)
      .slice()
      .sort((a, b) => b.term.length - a.term.length);
    const word = (character) => !!character && /[\p{L}\p{N}_]/u.test(character);
    const definitions = new Map();
    let active;
    function closeDefinition(returnFocus = false) {
      if (!active) return;
      active.card.hidden = true;
      active.button.setAttribute('aria-expanded', 'false');
      if (returnFocus) active.button.focus();
      active = undefined;
    }
    parent.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && active) {
        event.stopPropagation();
        closeDefinition(true);
      }
    });
    let cursor = 0;
    while (cursor < text.length) {
      let match;
      for (const concept of terms) {
        const normalizedText = text.toLocaleLowerCase();
        const normalizedTerm = concept.term.toLocaleLowerCase();
        let index = normalizedText.indexOf(normalizedTerm, cursor);
        while (index >= 0 && (word(text[index - 1]) || word(text[index + concept.term.length])))
          index = normalizedText.indexOf(normalizedTerm, index + 1);
        if (index < 0) continue;
        if (!match || index < match.index) match = { index, concept };
      }
      if (!match) {
        parent.append(document.createTextNode(text.slice(cursor)));
        break;
      }
      if (match.index > cursor)
        parent.append(document.createTextNode(text.slice(cursor, match.index)));
      const term = node(
        'button',
        text.slice(match.index, match.index + match.concept.term.length),
        'concept-term',
      );
      term.type = 'button';
      term.title = match.concept.explanation;
      term.setAttribute('aria-label', `Define ${term.textContent}`);
      term.setAttribute('aria-expanded', 'false');
      let card = definitions.get(match.concept.term);
      if (!card) {
        card = node('div', undefined, 'concept-definition');
        card.id = `concept-definition-${++definitionId}`;
        card.hidden = true;
        card.setAttribute('role', 'region');
        card.setAttribute('aria-label', `Definition of ${match.concept.term}`);
        const heading = node('div', undefined, 'concept-definition-heading');
        const close = node('button', '×', 'quiet');
        close.type = 'button';
        close.setAttribute('aria-label', 'Close definition');
        close.onclick = () => closeDefinition(true);
        heading.append(node('strong', match.concept.term), close);
        card.append(heading, node('p', match.concept.explanation));
        if (!nested) addConceptExpansion(card, match.concept, 'Explain further · AI ↗');
        definitions.set(match.concept.term, card);
      }
      term.setAttribute('aria-controls', card.id);
      term.onclick = () => {
        const wasOpen = active?.button === term;
        closeDefinition();
        if (!wasOpen) {
          card.hidden = false;
          term.setAttribute('aria-expanded', 'true');
          active = { button: term, card };
        }
      };
      parent.append(term);
      cursor = match.index + match.concept.term.length;
    }
    parent.append(...definitions.values());
  }
  const updateButtons = () => {
    document.querySelectorAll('.ai-action, .work-action').forEach((button) => {
      button.disabled = busy || stale;
    });
    $('apply').disabled = busy || stale || !canApply;
    $('replacement').disabled = busy || stale;
    const unchanged = $('replacement').value === originalCode;
    for (const id of ['preview', 'analyze', 'reset']) $(id).disabled = busy || stale || unchanged;
    $('mode').disabled = busy || tab === 'impact';
    $('audience').disabled = busy;
    $('refresh').disabled = busy;
    $('web-topic').disabled = busy;
    $('web-version').disabled = busy;
    $('web-filter').disabled = busy;
    $('web-find').disabled =
      busy || stale || !$('web-research').checked || !$('web-topic').value.trim();
    if (focusAfterWork && !busy && !stale) {
      focusAfterWork = false;
      $('replacement').focus();
    }
  };
  function clearEvidence() {
    evidence = [];
    evidenceNote = '';
    $('evidence').replaceChildren();
    $('evidence-section').hidden = true;
    document.querySelectorAll('.evidence-link').forEach((button) => {
      button.disabled = true;
    });
  }
  function request(task, extra = {}) {
    if (task === 'explain' || task === 'walkthrough') {
      pendingWeb = $('web-research').checked ? webQuery() : undefined;
      webLessonReady = false;
      $('web-result').replaceChildren();
      $('web-status').textContent = '';
    }
    $('error').hidden = true;
    post('request', {
      task,
      mode: $('mode').value,
      audience: $('audience').value,
      replacement: $('replacement').value,
      ...extra,
    });
  }
  function selectTab(name) {
    tab = name;
    $('mode').value = name === 'impact' ? 'project' : chosenMode;
    for (const view of ['understand', 'examples', 'impact']) $(view).hidden = view !== name;
    document.querySelectorAll('.tab').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === name);
      button.setAttribute('aria-pressed', String(button.dataset.tab === name));
    });
    $('evidence-section').hidden =
      !evidenceNote || (name !== 'impact' && $('mode').value !== 'project');
    updateButtons();
  }
  document
    .querySelectorAll('.tab')
    .forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.tab)));
  $('configure').onclick = () => post('configure');
  $('refresh').onclick = () => post('refresh');
  $('explain').onclick = () => request('explain');
  $('walkthrough').onclick = () => request('walkthrough');
  $('example').onclick = () => request('example');
  $('analyze').onclick = () => request('impact');
  $('preview').onclick = () => {
    $('error').hidden = true;
    post('preview', { replacement: $('replacement').value });
  };
  $('apply').onclick = () => post('apply', { replacement: $('replacement').value });
  $('reset').onclick = () => {
    $('replacement').value = originalCode;
    colors.resetDraft();
    lines.draft();
    canApply = false;
    $('error').hidden = true;
    $('preview-status').textContent = 'Back to the current code in your file. Try another change.';
    $('impact-result').replaceChildren();
    updateButtons();
    $('replacement').focus();
  };
  $('cancel').onclick = () => {
    pendingWeb = undefined;
    webRunning = false;
    $('web-status').textContent = 'Cancelled.';
    post('cancel');
  };
  $('web-research').onchange = () => {
    const enabled = $('web-research').checked;
    $('web-options').hidden = !enabled;
    if (!enabled) {
      pendingWeb = undefined;
      webRunning = false;
      $('web-result').replaceChildren();
      $('web-status').textContent = '';
    }
    post('researchToggle', { enabled });
    updateButtons();
  };
  $('web-topic').oninput = updateButtons;
  $('web-version').oninput = () => {
    versionEdited = true;
    $('web-version-note').textContent = $('web-version').value.trim()
      ? 'Custom target. Source compatibility still needs checking.'
      : 'No target version. Compatibility is unknown.';
  };
  $('web-filter').onchange = () => {
    document
      .querySelectorAll('.web-source-list')
      .forEach((list) => list.filterSources?.($('web-filter').value));
  };
  function webQuery() {
    return {
      topic: $('web-topic').value,
      audience: $('audience').value,
      ...($('web-version').value.trim() || $('web-filter').value !== 'all'
        ? { options: { version: $('web-version').value.trim(), filter: $('web-filter').value } }
        : {}),
    };
  }
  $('web-find').onclick = () => startWeb(webQuery());
  function startWeb(query) {
    if (busy || stale || !$('web-research').checked) return;
    pendingWeb = undefined;
    webRunning = true;
    $('web-result').replaceChildren();
    $('web-status').textContent = 'Finding useful web resources…';
    post('research', query);
  }
  function suggestWebTopic(code, language) {
    // Only fixed, public language/concept names leave this local suggestion step.
    // Identifiers, strings, paths, comments and surrounding project code are not copied.
    const topics = [
      [/\bextends\b|\bsuper\s*\(/, 'inheritance and constructor order'],
      [/\.stream\s*\(|\bStream\b/, 'streams'],
      [/\bOptional\b/, 'Optional'],
      [/\binterface\b|\bimplements\b/, 'interfaces'],
      [/\btry\b|\bcatch\b|\braise\b|\bexcept\b/, 'exception handling'],
      [/\basync\b|\bawait\b|\bPromise\b/, 'async and await'],
      [/=>|->|\blambda\b/, 'lambda expressions'],
      [/\b(?:for|while)\s*\(?/, 'loops'],
      [/\b(?:ArrayList|HashMap|List|Map|Set)\b/, 'collections'],
      [/\bclass\b/, 'classes and objects'],
      [/\b(?:const|let)\s*[{[]/, 'destructuring'],
      [/\b(?:function|def)\b/, 'functions'],
    ]
      .filter(([pattern]) => pattern.test(code))
      .slice(0, 2)
      .map(([, name]) => name);
    const name =
      [
        'Java',
        'TypeScript',
        'JavaScript',
        'Python',
        'Kotlin',
        'C#',
        'C++',
        'C',
        'Go',
        'Rust',
        'Ruby',
        'PHP',
        'Swift',
        'SQL',
        'HTML',
        'CSS',
      ].find((n) => n.toLowerCase() === String(language).toLowerCase()) || 'programming';
    return `${name} ${topics.length ? topics.join(' and ') : 'code examples'}`;
  }
  function renderResearch(result, archived = false) {
    const root = node('details', undefined, 'web-supplement');
    const sources = Array.isArray(result.sources)
      ? result.sources
          .filter((s) => {
            try {
              const u = new URL(s.url);
              return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
            } catch {
              return false;
            }
          })
          .slice(0, 12)
      : [];
    root.append(node('summary', `From the web · ${sources.length} sources`));
    const usage = result.usage;
    root.append(
      node(
        'p',
        `${archived ? 'SAVED WEB RESOURCES' : result.cached ? 'CACHED WEB RESOURCES' : 'WEB RESEARCH'} · ${result.provider} / ${result.model} · ${archived || result.cached ? '0 new tokens' : usage ? `${usage.total} tokens (${usage.input} input + ${usage.output} output)` : 'Token usage not reported'}`,
        'result-meta',
      ),
    );
    root.append(
      node(
        'p',
        `${result.topic}${result.options?.version ? ` · Target: ${result.options.version}` : ' · Version unspecified'} · Retrieved ${new Date(result.checkedAt).toLocaleString()}`,
        'muted',
      ),
    );
    if (!archived && !result.cached)
      root.append(
        node(
          'p',
          result.budget
            ? `Bounded lookup · ${result.budget.aiRequests} AI request · up to ${result.budget.maxOutputTokens} output tokens. Search: ${result.retrieval?.provider || 'public search'}.`
            : `${result.searches} reported search/tool calls. Search fees may also apply.`,
          'muted',
        ),
      );
    root.append(
      node(
        'p',
        'General learning material for this topic. Examples are illustrative and have not been run.',
        'muted',
      ),
    );
    function link(source, compact = false) {
      const a = node('a', compact ? source.title : `${source.title} ↗`, 'web-source');
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.onclick = (event) => {
        event.preventDefault();
        post('openWebSource', { url: source.url });
      };
      if (!compact)
        a.append(node('small', `${source.kind} · ${new URL(source.url).hostname}`, 'muted'));
      return a;
    }
    for (const block of (Array.isArray(result.blocks) ? result.blocks : []).slice(0, 20)) {
      const content = String(block.text || '');
      const shown = new Set();
      const positions = (Array.isArray(block.citations) ? block.citations : [])
        .filter(
          (c) =>
            c &&
            Number.isInteger(c.end) &&
            c.end >= 0 &&
            c.end <= content.length &&
            sources.some((s) => s.url === c.url),
        )
        .sort((a, b) => a.end - b.end);
      function paragraph(start, end) {
        if (!content.slice(start, end).trim()) return;
        const p = node('p', undefined, 'web-text');
        let cursor = start;
        const add = (value) =>
          // Groq browser IDs are page cursors, not source-list indexes. Remove the
          // opaque markers; the verified retrieved links remain in Sources below.
          p.append(
            document.createTextNode(value.replace(/cite[^]*|〖[^〗]*〗|【\d+†[^】]*】/g, '')),
          );
        for (const cite of positions.filter((c) => c.end > start && c.end <= end)) {
          add(content.slice(cursor, cite.end));
          const source = sources.find((s) => s.url === cite.url);
          p.append(document.createTextNode(' '), link(source, true), document.createTextNode(' '));
          shown.add(cite.url);
          cursor = cite.end;
        }
        add(content.slice(cursor, end));
        root.append(p);
      }
      const fence = /```(?:[\w#+.-]+)?[^\S\n]*\n([\s\S]*?)```/g;
      let cursor = 0,
        match;
      while ((match = fence.exec(content))) {
        paragraph(cursor, match.index);
        const pre = node('pre');
        pre.append(node('code', match[1]));
        root.append(pre);
        cursor = fence.lastIndex;
      }
      paragraph(cursor, content.length);
      const cited = sources.filter((s) => block.sourceUrls?.includes(s.url) && !shown.has(s.url));
      if (cited.length) {
        const citations = node('div', undefined, 'web-citations');
        citations.append(node('small', 'Sources for this passage: ', 'muted'));
        cited.forEach((s) => citations.append(link(s, true)));
        root.append(citations);
      }
    }
    root.append(node('h3', 'Explore the sources'));
    const sourceList = node('div', undefined, 'web-source-list');
    sourceList.filterSources = (filter) => {
      sourceList.replaceChildren();
      const visible = sources.filter((s) => matchesResource(s, filter));
      if (!visible.length)
        sourceList.append(
          node(
            'p',
            'No sources of this type in these results. Choose Find web resources to search this type.',
            'muted',
          ),
        );
      const row = (s) => {
        const item = node('div', undefined, 'web-resource-row'),
          label = node('div');
        label.append(link(s));
        item.append(label, bookmarkButton(s));
        return item;
      };
      visible.slice(0, 5).forEach((s) => sourceList.append(row(s)));
      if (visible.length > 5) {
        const more = node('details');
        more.append(node('summary', `${visible.length - 5} more sources`));
        visible.slice(5).forEach((s) => more.append(row(s)));
        sourceList.append(more);
      }
    };
    sourceList.filterSources(archived ? result.options?.filter || 'all' : $('web-filter').value);
    root.append(sourceList);
    root.append(
      node(
        'small',
        'Filtering these links is local. Citations stay visible; Find web resources runs a new search.',
        'muted',
      ),
    );
    return root;
  }
  $('replacement').oninput = () => {
    canApply = false;
    $('preview-status').textContent =
      'Ready for another try. Choose “See what changes” to compare.';
    $('impact-result').replaceChildren();
    updateButtons();
  };
  for (const id of ['mode', 'audience'])
    $(id).onchange = () => {
      if (id === 'mode') chosenMode = $('mode').value;
      saved.audience = $('audience').value;
      host.setState({ mode: chosenMode, audience: $('audience').value });
      $('explanation').replaceChildren();
      $('example-result').replaceChildren();
      $('impact-result').replaceChildren();
      pendingWeb = undefined;
      $('web-result').replaceChildren();
      $('web-status').textContent = '';
      conceptTargets.clear();
      selectTab(tab);
    };
  function evidenceLink(id) {
    const entry = evidence.find((e) => e.id === id);
    const button = node('button', entry ? `${entry.file}:${entry.line}` : id, 'evidence-link');
    button.onclick = () => post('openEvidence', { id });
    return button;
  }
  function renderLesson(
    lesson,
    meta,
    nested = false,
    task = 'explain',
    archived = false,
    language = sourceLanguage,
  ) {
    // Also repair older cached lessons before rendering either the list or inline definitions.
    const concepts = new Map();
    for (const concept of lesson.concepts) {
      const term = concept.term
        .normalize('NFKC')
        .trim()
        .replace(/^`([^`]+)`$/, '$1')
        .trim()
        .replace(/\s+/g, ' ');
      const key = term.toLowerCase(),
        previous = concepts.get(key);
      if (!key) continue;
      if (!previous) concepts.set(key, { ...concept, term });
      else if (!previous.explanation.trim() && concept.explanation.trim())
        previous.explanation = concept.explanation;
    }
    lesson = { ...lesson, concepts: [...concepts.values()] };
    const root = node('article', undefined, 'lesson');
    root.append(node('div', meta, 'result-meta'), node('h2', lesson.title));
    if (lesson.syntax) {
      const syntax = node('section', undefined, 'syntax-help');
      syntax.setAttribute('role', 'status');
      syntax.append(
        node('h3', lesson.syntax.partial ? 'Partial selection' : 'Syntax needs attention'),
      );
      const issues = node('ul');
      lesson.syntax.issues.forEach((issue) => issues.append(node('li', issue)));
      syntax.append(issues, node('p', lesson.syntax.explanation));
      if (lesson.syntax.corrected) {
        const preview = node('details');
        preview.append(node('summary', 'Suggested correction'));
        const pre = node('pre');
        pre.append(node('code', lesson.syntax.corrected));
        preview.append(pre);
        if (!nested) {
          const tryFix = node('button', 'Try corrected version');
          tryFix.type = 'button';
          const source = originalCode;
          tryFix.onclick = () => {
            if (busy || stale || originalCode !== source) return;
            $('replacement').value = lesson.syntax.corrected;
            $('replacement').dispatchEvent(new Event('input', { bubbles: true }));
            selectTab('impact');
            $('replacement').focus();
            $('replacement').scrollIntoView({ block: 'center' });
          };
          preview.append(tryFix);
        }
        syntax.append(preview);
      }
      root.append(syntax);
    }
    const summary = node('div', undefined, 'concept-copy');
    appendConceptText(summary, lesson.summary, lesson.concepts, nested);
    root.append(summary);
    if (lesson.notice) root.append(node('p', lesson.notice, 'muted'));
    if (lesson.steps.length) {
      const list = node('ol');
      lesson.steps.forEach((step) => {
        const item = node('li');
        appendConceptText(item, step, lesson.concepts, nested);
        list.append(item);
      });
      root.append(list);
    }
    if (lesson.note) {
      const note = node('p', undefined, 'lesson-note');
      appendConceptText(note, lesson.note, lesson.concepts, nested);
      root.append(note);
    }
    if (lesson.output?.text || lesson.output?.explanation) {
      if (lesson.output.text) {
        root.append(node('h3', 'Expected output'));
        const pre = node('pre');
        pre.append(node('code', lesson.output.text));
        root.append(pre);
      }
      if (lesson.output.explanation) root.append(node('p', lesson.output.explanation));
    }
    if (lesson.concepts.length) {
      const terms = node('details', undefined, 'lesson-terms');
      terms.append(node('summary', 'Terms'));
      lesson.concepts.forEach((concept) => {
        const detail = node('details');
        detail.append(node('summary', concept.term));
        if (concept.explanation) detail.append(node('p', concept.explanation));
        if (!nested) addConceptExpansion(detail, concept);
        terms.append(detail);
      });
      root.append(terms);
    }
    // Keep practice available without expanding every explanation into another lesson.
    const practice = node('details', undefined, 'lesson-practice');
    practice.open = task === 'example';
    practice.append(node('summary', 'Practice'));
    const hasPractice = lesson.example.code || lesson.example.explanation;
    if (hasPractice) {
      if (lesson.example.code) {
        practice.append(colors.block(lesson.example.code, language));
      }
      const exampleExplanation = node('div', undefined, 'concept-copy');
      appendConceptText(exampleExplanation, lesson.example.explanation, lesson.concepts, nested);
      practice.append(exampleExplanation);
    }
    if (hasPractice || (lesson.checks.length && task !== 'impact')) root.append(practice);
    lesson.predictions.forEach((prediction) => {
      const box = node('div', undefined, 'prediction');
      box.append(
        node('small', 'Predicted effect · verify before relying on it'),
        node('p', prediction.description),
      );
      if (!archived) prediction.evidenceIds.forEach((id) => box.append(evidenceLink(id)));
      root.append(box);
    });
    if (lesson.checks.length) {
      const list = node('ul');
      lesson.checks.forEach((check) => list.append(node('li', check)));
      if (task === 'impact') root.append(node('h3', 'Things to check'), list);
      else practice.append(list);
    }
    return root;
  }
  function renderParts(message) {
    const root = $('parts');
    let cursor = 0;
    for (const part of message.parts) {
      const start = part.start - message.start;
      const end = part.end - message.start;
      // Offsets refer to the whole file. Leave any unmapped source as plain text
      // rather than guessing where repeated names or punctuation belong.
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < cursor ||
        end <= start ||
        end > message.code.length
      )
        continue;
      root.append(colors.fragment(message.code.slice(cursor, start), cursor));
      // Inline spans can cross lines without changing tab stops or indentation.
      // Give them button semantics and the same keyboard controls as a button.
      const button = node('span', undefined, 'part');
      button.append(colors.fragment(message.code.slice(start, end), start));
      button.setAttribute('role', 'button');
      button.tabIndex = 0;
      button.setAttribute('aria-label', part.token);
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-controls', 'part-detail');
      const location = `${message.file}:${lines.location(start, end)}`;
      button.title = `${part.brief} (${location})`;
      button.onclick = () => {
        lines.select(start);
        root.querySelectorAll('.part').forEach((p) => {
          p.classList.remove('selected');
          p.setAttribute('aria-pressed', 'false');
        });
        button.classList.add('selected');
        button.setAttribute('aria-pressed', 'true');
        $('part-detail').hidden = false;
        $('part-detail').replaceChildren(
          node('small', location, 'part-location'),
          node('strong', part.brief),
          node('p', part.detail),
        );
      };
      button.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          button.click();
        }
      };
      root.append(button);
      cursor = end;
    }
    root.append(colors.fragment(message.code.slice(cursor), cursor));
    root.parentElement.scrollTop = 0;
    root.parentElement.scrollLeft = 0;
  }
  window.addEventListener('message', (event) => {
    const message = event.data;
    history.receive(message);
    if (message.type === 'bookmarks') {
      $('bookmark-feedback').hidden = true;
      bookmarksLoaded = true;
      bookmarks = (Array.isArray(message.entries) ? message.entries : [])
        .filter((b) => {
          try {
            const u = new URL(b.url);
            return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
          } catch {
            return false;
          }
        })
        .slice(0, 100);
      document.querySelectorAll('.bookmark-save').forEach((button) => button.refreshBookmark?.());
      if (!$('bookmarks-panel').hidden) {
        const returnFocus = $('bookmarks-list').contains(document.activeElement);
        drawBookmarks();
        if (returnFocus) $('bookmarks-search').focus();
      }
    } else if (message.type === 'bookmarkError') {
      if (!$('bookmarks-panel').hidden) drawBookmarks();
      $('bookmark-feedback').textContent = message.message;
      $('bookmark-feedback').hidden = false;
      document.querySelectorAll('.bookmark-save').forEach((button) => button.refreshBookmark?.());
    } else if (message.type === 'researchHints' && message.selectionId === versionSelection) {
      $('web-version-hints').replaceChildren();
      const hints = Array.isArray(message.hints) ? message.hints.slice(0, 8) : [];
      for (const hint of hints) {
        const option = node('option');
        option.value = hint.version;
        option.label = `Declared in ${hint.source}`;
        $('web-version-hints').append(option);
      }
      if (!versionEdited && !busy && hints.length) {
        $('web-version').value = hints[0].version;
        $('web-version-note').textContent =
          `Declared in ${hints[0].source}; not an installed-version check. Edit or choose another target.`;
      }
    }
    if (message.type === 'selection') {
      pendingWeb = undefined;
      webRunning = false;
      webLessonReady = false;
      $('web-topic').value = suggestWebTopic(message.code, message.language);
      versionEdited = false;
      versionSelection = message.selectionId;
      $('web-version').value = '';
      $('web-version-hints').replaceChildren();
      $('web-version-note').textContent = 'Version unknown. Enter a target if needed.';
      $('web-result').replaceChildren();
      $('web-status').textContent = '';
      stale = false;
      canApply = false;
      evidence = [];
      evidenceNote = '';
      conceptTargets.clear();
      $('stale').hidden = true;
      $('error').hidden = true;
      $('evidence-section').hidden = true;
      $('language').textContent = (message.language || 'TypeScript').toUpperCase();
      $('source').textContent = message.code;
      originalCode = message.code;
      sourceLanguage = message.language || 'TypeScript';
      $('replacement').value = message.code;
      colors.selection(message.code);
      lines.selection(message);
      $('location').textContent = `${message.file}:${message.line}`;
      $('preview-status').textContent = '';
      for (const id of ['explanation', 'example-result', 'impact-result', 'parts', 'evidence'])
        $(id).replaceChildren();
      $('part-detail').hidden = true;
      $('syntax-section').hidden = !message.parts.length;
      renderParts(message);
      selectTab(message.keepTab ? tab : 'understand');
      updateButtons();
    } else if (message.type === 'config') {
      if (typeof message.webResearch === 'boolean') {
        $('web-research').checked = message.webResearch;
        $('web-options').hidden = !message.webResearch;
      }
      $('web-model').textContent =
        `Web summary uses ${message.provider} / ${message.webResearchModel || 'a compact model'}; your explanation model stays unchanged.`;
      $('configure').textContent = message.hasKey
        ? `${message.provider} · Settings`
        : 'Connect provider';
      $('provider-status').textContent = message.hasKey
        ? `${message.provider} / ${message.model} · Ready on demand`
        : 'No API key needed for the small pieces. Connect a provider for AI help.';
      $('audience').value = saved.audience || message.audience;
      updateButtons();
    } else if (message.type === 'busy') {
      busy = message.value;
      $('progress').hidden = !busy;
      updateButtons();
      if (!busy && webLessonReady && pendingWeb) startWeb(pendingWeb);
      else if (!busy && webRunning) {
        webRunning = false;
        if (!$('web-result').children.length)
          $('web-status').textContent = 'Web lookup stopped. Your explanation is unchanged.';
      }
    } else if (message.type === 'error') {
      pendingWeb = undefined;
      $('error').textContent = message.message;
      $('error').hidden = false;
    } else if (message.type === 'lesson') {
      if (message.task === 'explain' || message.task === 'walkthrough') webLessonReady = true;
      const target =
        message.task === 'concept'
          ? conceptTargets.get(message.concept)
          : $(
              message.task === 'impact'
                ? 'impact-result'
                : message.task === 'example'
                  ? 'example-result'
                  : 'explanation',
            );
      if (target) {
        target.hidden = false;
        const usage = message.lesson.usage;
        const usageLabel = message.cached
          ? '0 new tokens'
          : usage
            ? `${usage.total} tokens (${usage.input} input + ${usage.output} output)`
            : 'Token usage not reported';
        target.replaceChildren(
          renderLesson(
            message.lesson,
            `${message.cached ? 'REUSED FROM CACHE · NO NEW REQUEST' : message.lesson.local ? 'LOCAL LEARNING HELP' : 'AI EXPLANATION'}${message.lesson.local ? '' : ` · ${message.provider} / ${message.model}`} · ${usageLabel}`,
            message.task === 'concept',
            message.task,
          ),
        );
      }
      updateButtons();
    } else if (message.type === 'research') {
      webRunning = false;
      if ($('web-research').checked && !stale) {
        $('web-result').replaceChildren(renderResearch(message.result));
        $('web-status').textContent = 'Web resources are ready. Open “From the web” below.';
      }
    } else if (message.type === 'researchError') {
      webRunning = false;
      pendingWeb = undefined;
      if ($('web-research').checked) $('web-status').textContent = message.message;
    } else if (message.type === 'evidence') {
      evidence = message.items;
      evidenceNote = message.note;
      $('evidence-note').textContent = message.note;
      $('evidence').replaceChildren();
      evidence.forEach((entry) => {
        const item = node('div', undefined, 'evidence-item');
        item.append(
          node(
            'div',
            `Confirmed ${entry.kind}${entry.test ? ' · Test file' : ''}`,
            'evidence-type',
          ),
          evidenceLink(entry.id),
        );
        const pre = node('pre');
        pre.append(node('code', entry.code));
        item.append(pre);
        $('evidence').append(item);
      });
      selectTab(tab);
    } else if (message.type === 'previewReset') {
      canApply = false;
      $('preview-status').textContent = '';
      updateButtons();
    } else if (message.type === 'preview') {
      canApply =
        message.syntaxChecked !== false &&
        !message.errors.length &&
        message.replacement === $('replacement').value &&
        !stale;
      $('preview-status').textContent = message.errors.length
        ? `Something needs fixing: ${message.errors.join(' ')} Edit your version and try again.`
        : message.syntaxChecked === false
          ? 'Comparison opened. This language has no syntax checker installed; applying edits is unavailable.'
          : 'Comparison opened. Keep tinkering, or use this code in your file. No syntax errors found; code and tests have not been run.';
      updateButtons();
    } else if (message.type === 'stale') {
      pendingWeb = undefined;
      webRunning = false;
      stale = true;
      lines.refresh();
      canApply = false;
      $('stale').hidden = false;
      clearEvidence();
      $('impact-result').replaceChildren();
      updateButtons();
    } else if (message.type === 'contextChanged') {
      canApply = false;
      $('preview-status').textContent = 'Workspace changed. Choose “See what changes” again.';
      $('impact-result').replaceChildren();
      if (chosenMode === 'project') {
        $('explanation').replaceChildren();
        $('example-result').replaceChildren();
        conceptTargets.clear();
      }
      clearEvidence();
      updateButtons();
    } else if (message.type === 'applied') {
      canApply = false;
      focusAfterWork = true;
      $('preview-status').textContent =
        'Your file now uses this version. Keep tinkering below and compare again. Ctrl/Cmd+Z in the editor undoes the change.';
      updateButtons();
    }
  });
  post('ready');
})();
