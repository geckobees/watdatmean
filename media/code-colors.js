/* Local rendering only. Source text never becomes HTML or CSS. */
window.watdatmeanColors = (host) => {
  const $ = (id) => document.getElementById(id);
  const input = $('replacement'),
    mirror = $('draft-colors'),
    box = $('code-input');
  const palettes = { source: '', draft: '' };
  const styles = { source: undefined, draft: undefined };
  const pending = { source: 0, draft: 0 };
  const retries = new Map();
  const blocks = new Map();
  let original = '',
    serial = 0,
    timer,
    composing = false;
  const empty = () => ({ runs: [], styles: [] });
  function validate(message) {
    if (
      !Array.isArray(message.runs) ||
      !Array.isArray(message.styles) ||
      message.runs.length > 12000 ||
      message.styles.length > 4096
    )
      return empty();
    if (
      !message.styles.every(
        (s) =>
          s &&
          /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(s.color) &&
          Number.isInteger(s.font) &&
          s.font >= 0 &&
          s.font <= 15,
      )
    )
      return empty();
    let previous = 0;
    for (const run of message.runs) {
      if (
        !Array.isArray(run) ||
        run.length !== 3 ||
        !run.every(Number.isInteger) ||
        run[0] < previous ||
        run[1] <= run[0] ||
        run[1] > message.code.length ||
        run[2] < 0 ||
        run[2] >= message.styles.length
      )
        return empty();
      previous = run[1];
    }
    return message;
  }
  function paint(element, text, offset, target) {
    const result = document.createDocumentFragment();
    let cursor = 0;
    for (const [start, end, style] of styles[target]?.runs ?? []) {
      const a = Math.max(0, start - offset),
        b = Math.min(text.length, end - offset);
      if (a >= b) continue;
      if (a > cursor) result.append(document.createTextNode(text.slice(cursor, a)));
      const span = document.createElement('span');
      span.className = `wdm-${target}-${style}`;
      span.textContent = text.slice(a, b);
      result.append(span);
      cursor = b;
    }
    result.append(document.createTextNode(text.slice(cursor)));
    element.replaceChildren(result);
  }
  function palette(target, colors) {
    styles[target] = colors;
    palettes[target] = colors.styles
      .map(
        (s, i) =>
          `.wdm-${target}-${i}{color:${s.color};${target !== 'draft' ? `font-style:${s.font & 1 ? 'italic' : 'normal'};font-weight:${s.font & 2 ? 'bold' : 'inherit'};text-decoration:${[s.font & 4 ? 'underline' : '', s.font & 8 ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'};` : ''}}`,
      )
      .join('\n');
    $('code-palette').textContent = Object.values(palettes).join('\n');
  }
  function scroll() {
    mirror.parentElement.scrollTop = input.scrollTop;
    mirror.parentElement.scrollLeft = input.scrollLeft;
  }
  function draft() {
    paint(mirror, input.value, 0, 'draft');
    // An extra line gives the caret room after a final newline; aria-hidden avoids duplicate speech.
    mirror.append(document.createTextNode('\n'));
    box.classList.toggle('has-colors', !composing && input.value.length <= 50000);
    scroll();
  }
  function request(target, code, language, retry = false) {
    clearTimeout(retries.get(target));
    retries.delete(target);
    const id = ++serial;
    pending[target] = id;
    if (!retry) retries.set(target, undefined);
    if (code.length <= 50000)
      host.postMessage({ type: 'highlight', target, id, code, ...(language ? { language } : {}) });
  }
  function retryEmpty(message, colors, language) {
    const target = message.target;
    if (
      colors.runs.length ||
      !message.code.trim() ||
      !retries.has(target) ||
      retries.get(target) !== undefined
    )
      return;
    retries.set(
      target,
      setTimeout(() => {
        if (pending[target] === message.id) request(target, message.code, language, true);
      }, 180),
    );
  }
  function prune() {
    let changed = false;
    for (const [target, block] of blocks) {
      if (block.element.isConnected) continue;
      block.dispose();
      blocks.delete(target);
      delete palettes[target];
      delete styles[target];
      delete pending[target];
      clearTimeout(retries.get(target));
      retries.delete(target);
      changed = true;
    }
    if (changed) $('code-palette').textContent = Object.values(palettes).join('\n');
  }
  new MutationObserver(prune).observe(document.body, { childList: true, subtree: true });
  function updateDraft(immediate = false) {
    clearTimeout(timer);
    pending.draft = ++serial;
    if (input.value === original && styles.source) {
      palette('draft', styles.source);
      draft();
      return;
    }
    palette('draft', empty());
    draft();
    if (!composing) {
      if (immediate) request('draft', input.value);
      else timer = setTimeout(() => request('draft', input.value), 120);
    }
  }
  input.addEventListener('input', () => updateDraft());
  input.addEventListener('scroll', scroll);
  input.addEventListener('compositionstart', () => {
    composing = true;
    clearTimeout(timer);
    draft();
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    updateDraft();
  });
  window.addEventListener('message', ({ data: message }) => {
    if (message?.type === 'syntaxThemeChanged') {
      clearTimeout(timer);
      pending.draft = ++serial;
      request('source', original);
      if (input.value !== original) updateDraft(true);
      prune();
      for (const [target, block] of blocks) request(target, block.code, block.language);
    } else if (message?.type === 'highlight' && blocks.has(message.target)) {
      const block = blocks.get(message.target);
      if (
        !block.element.isConnected ||
        message.id !== pending[message.target] ||
        message.code !== block.code
      )
        return;
      const colors = validate(message);
      if (colors === message) retryEmpty(message, colors, block.language);
      palette(message.target, colors);
      paint(block.element, block.code, 0, message.target);
    } else if (message?.type === 'highlight' && ['source', 'draft'].includes(message.target)) {
      const target = message.target;
      if (
        message.id !== pending[target] ||
        message.code !== (target === 'source' ? original : input.value)
      )
        return;
      const colors = validate(message);
      if (colors === message) retryEmpty(message, colors);
      palette(target, colors);
      if (target === 'source') {
        paint($('source'), original, 0, 'source');
        document.querySelectorAll('#parts [data-code-start]').forEach((element) => {
          const start = Number(element.dataset.codeStart),
            end = Number(element.dataset.codeEnd);
          paint(element, original.slice(start, end), start, 'source');
        });
        if (input.value === original) {
          palette('draft', colors);
          draft();
        }
      } else draft();
    }
  });
  return {
    // Independent snapshots: no file lookup, live-document semantics, or AI request.
    block(code, language, firstLine = 1, className = '') {
      const frame = document.createElement('div');
      frame.className = `numbered-code standalone-code ${className}`;
      const gutter = document.createElement('div'),
        labels = document.createElement('div');
      gutter.className = 'line-gutter';
      labels.className = 'line-numbers';
      gutter.setAttribute('aria-hidden', 'true');
      gutter.append(labels);
      const pre = document.createElement('pre'),
        element = document.createElement('code');
      element.textContent = code;
      pre.append(element);
      frame.append(gutter, pre);
      const count = code.split(/\r\n|\r|\n/).length;
      firstLine = Number.isSafeInteger(firstLine) && firstLine > 0 ? firstLine : 1;
      frame.style.setProperty(
        '--gutter-digits',
        String(Math.max(3, String(firstLine + count - 1).length)),
      );
      frame.style.setProperty('--code-line-count', String(count));
      let animation = 0;
      function sync() {
        animation = 0;
        if (!pre.clientHeight) return;
        const css = getComputedStyle(pre),
          height = parseFloat(css.lineHeight),
          padding = parseFloat(css.paddingTop);
        const start = Math.max(0, Math.floor((pre.scrollTop - padding) / height));
        const end = Math.min(count, start + Math.ceil(pre.clientHeight / height) + 2);
        gutter.style.height = `${pre.clientHeight}px`;
        labels.style.top = `${padding + start * height - pre.scrollTop}px`;
        const rows = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
          const row = document.createElement('span');
          row.className = 'line-number';
          row.textContent = String(firstLine + i);
          row.style.height = `${height}px`;
          rows.append(row);
        }
        labels.replaceChildren(rows);
      }
      function refresh() {
        if (!animation) animation = requestAnimationFrame(sync);
      }
      const resize = new ResizeObserver(refresh);
      resize.observe(pre);
      pre.addEventListener('scroll', refresh, { passive: true });
      const target = `block-${++serial}`;
      queueMicrotask(() => {
        prune();
        if (!element.isConnected) {
          resize.disconnect();
          return;
        }
        blocks.set(target, {
          element,
          code,
          language,
          dispose() {
            resize.disconnect();
            cancelAnimationFrame(animation);
          },
        });
        request(target, code, language);
        refresh();
      });
      return frame;
    },
    selection(code) {
      original = code;
      clearTimeout(timer);
      pending.draft = ++serial;
      palette('source', empty());
      palette('draft', empty());
      draft();
      request('source', code);
    },
    fragment(text, start) {
      const span = document.createElement('span');
      span.dataset.codeStart = start;
      span.dataset.codeEnd = start + text.length;
      paint(span, text, start, 'source');
      return span;
    },
    resetDraft: () => updateDraft(true),
  };
};
