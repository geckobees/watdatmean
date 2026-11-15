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
    language = '',
    serial = 0,
    timer,
    composing = false;
  const empty = () => ({ runs: [], styles: [] });
  // A small offline lexical fallback keeps familiar code readable while a language
  // plugin loads or is unavailable. Native syntax/semantic ranges always take over.
  // It does not infer variable types, library origins, or runtime behavior.
  function fallback(code, name) {
    if (code.length > 50000) return empty();
    const lang = String(name).toLowerCase();
    const python = lang === 'python';
    const java = lang === 'java';
    const script = [
      'typescript',
      'javascript',
      'typescript jsx',
      'javascript jsx',
      'typescriptreact',
      'javascriptreact',
      'tsx',
      'jsx',
    ].includes(lang);
    if (!python && !java && !script) return empty();
    const css = getComputedStyle(document.documentElement);
    const background = css.getPropertyValue('--code-background').trim();
    const rgb = /^#([\da-f]{6})$/i.exec(background);
    const channels = rgb
      ? [0, 2, 4].map((i) => parseInt(rgb[1].slice(i, i + 2), 16))
      : background
          .match(/[\d.]+/g)
          ?.slice(0, 3)
          .map(Number);
    const light =
      channels?.length === 3 &&
      channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 150;
    const defaults = light
      ? ['#0000aa', '#a31515', '#098658', '#387638']
      : ['#569cd6', '#ce9178', '#b5cea8', '#6a9955'];
    const result = {
      runs: [],
      styles: ['keyword', 'string', 'number', 'comment'].map((kind, i) => {
        const color = css.getPropertyValue(`--wdm-code-${kind}`).trim();
        return { color: /^#[\da-f]{6}$/i.test(color) ? color : defaults[i], font: 0 };
      }),
    };
    const common =
      'if else for while return break continue class try finally throw new this static void public private protected import switch case default true false null';
    const words = new Set(
      (java
        ? common +
          ' extends implements interface abstract final synchronized volatile transient native strictfp throws catch package instanceof super boolean byte char double float int long short assert enum record var yield sealed permits'
        : python
          ? 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'
          : common +
            ' const let var function async await export from extends implements interface type typeof instanceof delete in of do catch super constructor get set as is keyof readonly declare namespace module abstract override undefined'
      ).split(' '),
    );
    const tokens = python
      ? /#[^\r\n]*|"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\[\s\S]|[^"\\\r\n])*"?|'(?:\\[\s\S]|[^'\\\r\n])*'?|\b(?:0[xob][\da-f_]+|\d[\w.]*)\b|\b[A-Za-z_$][\w$]*\b/gi
      : /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|"""[\s\S]*?(?:"""|$)|"(?:\\[\s\S]|[^"\\\r\n])*"?|'(?:\\[\s\S]|[^'\\\r\n])*'?|`(?:\\[\s\S]|[^`\\])*`?|\b(?:0[xob][\da-f_]+|\d[\w.]*)\b|\b[A-Za-z_$][\w$]*\b/gi;
    for (const match of code.matchAll(tokens)) {
      const token = match[0];
      const kind =
        token.startsWith('//') || token.startsWith('/*') || (python && token.startsWith('#'))
          ? 3
          : /^["'`]/.test(token)
            ? 1
            : /^\d/.test(token)
              ? 2
              : words.has(token)
                ? 0
                : -1;
      if (kind >= 0) result.runs.push([match.index, match.index + token.length, kind]);
      if (result.runs.length >= 12000) break;
    }
    return result;
  }
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
    palette('draft', fallback(input.value, language));
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
      // Drop old-theme colors immediately so light/dark switches stay legible.
      palette('source', fallback(original, language));
      paintSource();
      request('source', original);
      if (input.value !== original) updateDraft(true);
      prune();
      for (const [target, block] of blocks) {
        palette(target, fallback(block.code, block.language));
        paint(block.element, block.code, 0, target);
        request(target, block.code, block.language);
      }
    } else if (message?.type === 'highlight' && blocks.has(message.target)) {
      const block = blocks.get(message.target);
      if (
        !block.element.isConnected ||
        message.id !== pending[message.target] ||
        message.code !== block.code
      )
        return;
      const colors = validate(message);
      if (colors !== message) return;
      retryEmpty(message, colors, block.language);
      if (!colors.runs.length && styles[message.target]?.runs.length) return;
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
      if (colors !== message) return;
      retryEmpty(message, colors);
      if (!colors.runs.length && styles[target]?.runs.length) return;
      palette(target, colors);
      if (target === 'source') {
        paintSource();
      } else draft();
    }
  });
  function paintSource() {
    paint($('source'), original, 0, 'source');
    document.querySelectorAll('#parts [data-code-start]').forEach((element) => {
      const start = Number(element.dataset.codeStart),
        end = Number(element.dataset.codeEnd);
      paint(element, original.slice(start, end), start, 'source');
    });
    if (input.value === original) {
      palette('draft', styles.source);
      draft();
    }
  }
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
        palette(target, fallback(code, language));
        paint(element, code, 0, target);
        request(target, code, language);
        refresh();
      });
      return frame;
    },
    selection(code, name) {
      original = code;
      language = name;
      clearTimeout(timer);
      pending.draft = ++serial;
      palette('source', fallback(code, language));
      paint($('source'), code, 0, 'source');
      palette('draft', styles.source);
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
