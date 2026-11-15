/* All code and model output is rendered as text, never as HTML. */
(() => {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const post = (type, extra = {}) => vscode.postMessage({ type, ...extra });
  let busy = false;
  let stale = false;
  let tab = 'understand';
  let evidence = [];
  let evidenceNote = '';
  let canApply = false;
  let originalCode = '';
  let focusAfterWork = false;
  const conceptTargets = new Map();
  let definitionId = 0;
  const saved = vscode.getState() || {};
  let soundEnabled = saved.sound === true;
  let audioContext;
  const switchBuffers = new Map();
  const activeSounds = new Set();
  let soundVariation = 0;
  let pieceButtons = [];
  let selectedPiece = -1;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motionEnabled = (saved.motionEnabled ?? saved.sceneMotion) !== false;
  $('mode').value = saved.mode || 'standalone';
  let chosenMode = $('mode').value;
  function updateSettingsSummary() {
    $('settings-summary').textContent =
      `${$('audience').selectedOptions[0].text} · ${$('mode').selectedOptions[0].text}`;
  }
  updateSettingsSummary();
  const persistPreferences = () =>
    vscode.setState({
      ...saved,
      mode: chosenMode,
      audience: $('audience').value,
      sound: soundEnabled,
      motionEnabled,
    });
  function syncMotion() {
    const enabled = motionEnabled && !reducedMotion.matches;
    document.body.classList.toggle('motion-paused', !enabled);
    $('motion-toggle').textContent = reducedMotion.matches
      ? 'Motion reduced'
      : motionEnabled
        ? 'Motion on'
        : 'Motion off';
    $('motion-toggle').title = motionEnabled
      ? 'Turn off interface animations'
      : 'Turn on interface animations';
    $('motion-toggle').disabled = reducedMotion.matches;
    $('motion-toggle').setAttribute('aria-pressed', String(enabled));
    if (!enabled) document.getAnimations().forEach((animation) => animation.cancel());
  }
  syncMotion();
  reducedMotion.addEventListener('change', syncMotion);
  $('motion-toggle').onclick = () => {
    motionEnabled = !motionEnabled;
    syncMotion();
    persistPreferences();
  };
  function updateSoundToggle() {
    $('sound-toggle').textContent = soundEnabled ? 'Sound on' : 'Sound off';
    $('sound-toggle').setAttribute('aria-pressed', String(soundEnabled));
    $('sound-toggle').title = soundEnabled
      ? 'Turn off interaction sounds'
      : 'Turn on interaction sounds';
  }
  // Frequency, body decay, return delay/weight, noise, damping, length, peak.
  // Each control family has its own keycap/resonance, not just a volume change.
  const touchProfiles = {
    piece: [540, 0.006, 0.017, 0.16, 0.65, 3100, 0.065, 0.13],
    step: [390, 0.009, 0.026, 0.38, 0.45, 2400, 0.085, 0.14],
    'view-understand': [275, 0.014, 0.031, 0.3, 0.5, 1900, 0.105, 0.16],
    'view-examples': [470, 0.008, 0.024, 0.48, 0.6, 2900, 0.09, 0.15],
    'view-impact': [340, 0.011, 0.055, 0.65, 0.4, 2200, 0.135, 0.16],
    action: [215, 0.018, 0.043, 0.22, 0.55, 1650, 0.14, 0.18],
    open: [680, 0.004, 0.012, 0.12, 0.95, 2800, 0.05, 0.11],
    close: [290, 0.006, 0.015, 0.1, 0.5, 1300, 0.055, 0.11],
    setting: [820, 0.0045, 0.02, 0.45, 0.7, 3400, 0.07, 0.12],
    apply: [310, 0.013, 0.064, 0.65, 0.45, 2100, 0.16, 0.17],
  };
  function makeSwitchBuffer(context, kind, variation) {
    const [frequency, decay, returnDelay, returnWeight, noiseWeight, cutoff, duration, level] =
      touchProfiles[kind] || touchProfiles.action;
    const sampleRate = context.sampleRate;
    const buffer = context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
    const samples = buffer.getChannelData(0);
    const pitch = [0.985, 1.01, 1.02, 0.995][variation];
    let seed = 4711 + variation * 317;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 4294967296) * 2 - 1;
    };
    let roundedNoise = 0;
    const smoothing = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    const strike = (time, strength, tuning, noise) => {
      if (time < 0) return 0;
      const attack = 1 - Math.exp(-time / 0.00035);
      const body =
        0.72 * Math.sin(2 * Math.PI * frequency * tuning * time) * Math.exp(-time / decay) +
        0.34 *
          Math.sin(2 * Math.PI * frequency * 2.39 * tuning * time) *
          Math.exp(-time / (decay * 0.55)) +
        0.15 *
          Math.sin(2 * Math.PI * frequency * 5.29 * tuning * time) *
          Math.exp(-time / (decay * 0.25));
      const contact = noise * noiseWeight * Math.exp(-time / 0.0022);
      return (body + contact) * attack * strength;
    };
    // Damped contact and keycap resonances keep every profile short and tactile.
    for (let i = 0; i < samples.length; i++) {
      const time = i / sampleRate;
      roundedNoise += smoothing * (random() - roundedNoise);
      samples[i] =
        strike(time, 1, pitch, roundedNoise) +
        strike(time - returnDelay, returnWeight, pitch * 1.18, roundedNoise);
    }
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    const gain = level / Math.max(peak, 0.001);
    for (let i = 0; i < samples.length; i++) {
      const fadeOut = Math.min(1, (samples.length - 1 - i) / (sampleRate * 0.008));
      samples[i] *= gain * fadeOut;
    }
    return buffer;
  }
  async function playTouch(kind = 'action') {
    if (!soundEnabled) return;
    try {
      audioContext ||= new AudioContext();
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (!soundEnabled) return;
      const variation = soundVariation++ % 4;
      const key = `${kind}:${variation}`;
      if (!switchBuffers.has(key))
        switchBuffers.set(key, makeSwitchBuffer(audioContext, kind, variation));
      // Bound overlapping taps, including bursts queued while audio resumes.
      if (activeSounds.size >= 4) {
        const oldest = activeSounds.values().next().value;
        oldest.stop();
        oldest.disconnect();
        activeSounds.delete(oldest);
      }
      const source = audioContext.createBufferSource();
      source.buffer = switchBuffers.get(key);
      source.connect(audioContext.destination);
      source.onended = () => {
        source.disconnect();
        activeSounds.delete(source);
      };
      activeSounds.add(source);
      source.start();
    } catch {
      // Audio support must never interrupt learning or change an action's outcome.
    }
  }
  updateSoundToggle();
  $('sound-toggle').onclick = () => {
    soundEnabled = !soundEnabled;
    if (!soundEnabled) {
      for (const source of activeSounds) {
        source.stop();
        source.disconnect();
      }
      activeSounds.clear();
    }
    updateSoundToggle();
    persistPreferences();
    void playTouch('setting');
  };
  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest('button, [role="button"], summary');
      if (!control || control.matches(':disabled, [aria-disabled="true"], #sound-toggle')) return;
      let kind = 'action';
      if (control.classList.contains('tab')) kind = `view-${control.dataset.tab}`;
      else if (control.classList.contains('part')) kind = 'piece';
      else if (control.matches('#previous-piece, #next-piece')) kind = 'step';
      else if (control.matches('summary')) kind = control.parentElement.open ? 'close' : 'open';
      else if (control.classList.contains('concept-term'))
        kind = control.getAttribute('aria-expanded') === 'true' ? 'close' : 'open';
      else if (control.id === 'apply') kind = 'apply';
      else if (control.matches('#cancel, #reset, .concept-definition .quiet')) kind = 'close';
      else if (control.matches('#motion-toggle, #configure')) kind = 'setting';
      void playTouch(kind);
    },
    { capture: true },
  );
  document.addEventListener('change', (event) => {
    if (event.target instanceof Element && event.target.matches('#mode, #audience'))
      void playTouch('setting');
  });
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
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
  function appendConceptText(parent, text, concepts, highlighted, nested = false) {
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
        if (highlighted.has(normalizedTerm)) continue;
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
      highlighted.add(match.concept.term.toLocaleLowerCase());
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
    if (focusAfterWork && !busy && !stale) {
      focusAfterWork = false;
      $('replacement').focus();
    }
  };
  function request(task, extra = {}) {
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
    document.querySelector('.tabs').dataset.active = name;
    $('mode').value = name === 'impact' ? 'project' : chosenMode;
    updateSettingsSummary();
    for (const view of ['understand', 'examples', 'impact']) $(view).hidden = view !== name;
    document.querySelectorAll('.tab').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === name);
      button.setAttribute('aria-pressed', String(button.dataset.tab === name));
    });
    $('evidence-section').hidden =
      !evidenceNote || (name !== 'impact' && $('mode').value !== 'project');
    updateButtons();
  }
  document.querySelectorAll('.tab').forEach((button) =>
    button.addEventListener('click', () => {
      selectTab(button.dataset.tab);
    }),
  );
  $('configure').onclick = () => post('configure');
  $('refresh').onclick = () => post('refresh');
  $('explain').onclick = () => request('explain');
  $('example').onclick = () => request('example');
  $('analyze').onclick = () => request('impact');
  $('preview').onclick = () => {
    $('error').hidden = true;
    post('preview', { replacement: $('replacement').value });
  };
  $('apply').onclick = () => post('apply', { replacement: $('replacement').value });
  $('reset').onclick = () => {
    $('replacement').value = originalCode;
    canApply = false;
    $('error').hidden = true;
    $('preview-status').textContent = 'Restored the current code from your file.';
    $('impact-result').replaceChildren();
    updateButtons();
    $('replacement').focus();
  };
  $('cancel').onclick = () => post('cancel');
  $('replacement').oninput = () => {
    canApply = false;
    $('preview-status').textContent = 'Code edited. Choose “See what changes” to compare.';
    $('impact-result').replaceChildren();
    updateButtons();
  };
  for (const id of ['mode', 'audience'])
    $(id).onchange = () => {
      if (id === 'mode') chosenMode = $('mode').value;
      saved.audience = $('audience').value;
      persistPreferences();
      $('explanation').replaceChildren();
      $('example-result').replaceChildren();
      $('impact-result').replaceChildren();
      conceptTargets.clear();
      selectTab(tab);
    };
  function evidenceLink(id) {
    const entry = evidence.find((e) => e.id === id);
    const button = node('button', entry ? `${entry.file}:${entry.line}` : id, 'evidence-link');
    button.onclick = () => post('openEvidence', { id });
    return button;
  }
  function renderUsage(message) {
    const root = node('div', undefined, 'token-usage');
    root.setAttribute('aria-label', 'Token usage for this request');
    if (message.cached) {
      root.textContent = '0 new tokens · Reused locally';
      root.title = 'This answer came from WatDatMean’s cache. No API request or new charge.';
      return root;
    }
    const usage = message.usage;
    if (!usage) {
      root.textContent =
        message.type === 'error'
          ? 'Token usage unavailable · Check provider billing'
          : 'Token usage not reported';
      root.title =
        'The provider did not return token counts. Missing usage does not mean zero cost.';
      return root;
    }
    const format = (value) => new Intl.NumberFormat().format(value);
    root.title =
      'Provider-reported tokens for this request, including instructions and context. Prices vary by model and token type; see your provider’s billing for the charge.';
    const counts = node('div', undefined, 'token-counts');
    counts.append(
      node(
        'strong',
        usage.totalTokens === undefined
          ? 'Total unavailable'
          : `${format(usage.totalTokens)} tokens`,
      ),
      node(
        'span',
        usage.inputTokens === undefined
          ? 'Input unavailable'
          : `${format(usage.inputTokens)} input`,
      ),
      node(
        'span',
        usage.outputTokens === undefined
          ? 'Output unavailable'
          : `${format(usage.outputTokens)} output`,
      ),
    );
    root.append(counts);
    const details = [];
    if (usage.cachedInputTokens > 0)
      details.push(`${format(usage.cachedInputTokens)} cached input`);
    if (usage.cacheWriteTokens > 0)
      details.push(`${format(usage.cacheWriteTokens)} cache-write input`);
    if (usage.reasoningTokens > 0)
      details.push(`${format(usage.reasoningTokens)} reasoning output`);
    if (details.length)
      root.append(node('div', `Includes ${details.join(' · ')}`, 'token-details'));
    return root;
  }
  function renderLesson(lesson, message, nested = false) {
    const root = node('article', undefined, 'lesson');
    // Share first appearances across this answer, but start fresh for a new answer.
    const highlighted = new Set();
    const meta = `${message.cached ? 'REUSED FROM CACHE · NO NEW REQUEST' : 'AI EXPLANATION'} · ${message.provider} / ${message.model}`;
    root.append(node('div', meta, 'result-meta'), renderUsage(message), node('h2', lesson.title));
    const summary = node('div', undefined, 'concept-copy');
    appendConceptText(summary, lesson.summary, lesson.concepts, highlighted, nested);
    root.append(summary);
    if (lesson.steps.length) {
      root.append(node('h3', 'Steps'));
      const list = node('ol');
      lesson.steps.forEach((step) => {
        const item = node('li');
        appendConceptText(item, step, lesson.concepts, highlighted, nested);
        list.append(item);
      });
      root.append(list);
    }
    if (lesson.concepts.length) {
      root.append(node('h3', 'Concepts'));
      lesson.concepts.forEach((concept) => {
        const detail = node('details');
        detail.append(node('summary', concept.term), node('p', concept.explanation));
        if (!nested) addConceptExpansion(detail, concept);
        root.append(detail);
      });
    }
    if (lesson.example.code || lesson.example.explanation) {
      root.append(node('h3', 'Example'));
      if (lesson.example.code) {
        const pre = node('pre');
        pre.append(node('code', lesson.example.code));
        root.append(pre);
      }
      const exampleExplanation = node('div', undefined, 'concept-copy');
      appendConceptText(
        exampleExplanation,
        lesson.example.explanation,
        lesson.concepts,
        highlighted,
        nested,
      );
      root.append(exampleExplanation);
    }
    lesson.predictions.forEach((prediction) => {
      const box = node('div', undefined, 'prediction');
      box.append(
        node('small', 'Predicted effect · verify before relying on it'),
        node('p', prediction.description),
      );
      prediction.evidenceIds.forEach((id) => box.append(evidenceLink(id)));
      root.append(box);
    });
    if (lesson.checks.length) {
      root.append(node('h3', 'Checks'));
      const list = node('ul');
      lesson.checks.forEach((check) => list.append(node('li', check)));
      root.append(list);
    }
    return root;
  }
  function renderParts(message) {
    const root = $('parts');
    pieceButtons = [];
    selectedPiece = -1;
    $('piece-placeholder').hidden = false;
    $('piece-navigation').hidden = true;
    $('source-disclosure').open = !message.parts.length;
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
      root.append(document.createTextNode(message.code.slice(cursor, start)));
      // Keep whitespace as source text; inline spans also support multiline tokens.
      // Give them button semantics and the same keyboard controls as a button.
      const button = node('span', message.code.slice(start, end), 'part');
      button.setAttribute('role', 'button');
      button.tabIndex = 0;
      button.setAttribute('aria-label', part.token);
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-controls', 'part-detail');
      button.title = part.brief;
      const index = pieceButtons.length;
      button.onclick = () => {
        const reading = document.querySelector('.piece-reading');
        reading.getAnimations().forEach((animation) => animation.cancel());
        const previousHeight = reading.getBoundingClientRect().height;
        root.querySelectorAll('.part').forEach((p) => {
          p.classList.remove('selected');
          p.setAttribute('aria-pressed', 'false');
        });
        button.classList.add('selected');
        button.setAttribute('aria-pressed', 'true');
        selectedPiece = index;
        $('piece-placeholder').hidden = true;
        $('part-detail').hidden = false;
        $('part-detail').replaceChildren(
          node('code', part.token, 'part-token'),
          node('h3', part.brief),
          node('p', part.detail),
        );
        $('piece-navigation').hidden = false;
        $('piece-position').textContent = `Piece ${index + 1} of ${pieceButtons.length}`;
        $('previous-piece').disabled = index === 0;
        $('next-piece').disabled = index === pieceButtons.length - 1;
        if (motionEnabled && !reducedMotion.matches) {
          const nextHeight = reading.getBoundingClientRect().height;
          reading.animate([{ height: `${previousHeight}px` }, { height: `${nextHeight}px` }], {
            duration: 240,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          });
          $('part-detail')
            .getAnimations()
            .forEach((animation) => animation.cancel());
          $('part-detail').animate(
            [
              { opacity: 0.35, transform: 'translateY(4px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          );
        }
      };
      button.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          button.click();
        }
      };
      root.append(button);
      pieceButtons.push(button);
      cursor = end;
    }
    root.append(document.createTextNode(message.code.slice(cursor)));
    root.parentElement.scrollTop = 0;
    root.parentElement.scrollLeft = 0;
  }
  function movePiece(offset) {
    const next = pieceButtons[selectedPiece + offset];
    if (!next) return;
    next.onclick();
    // Keep the code piece visible inside its scroll area without moving the page
    // away from the explanation and navigation the learner is using.
    const scroller = $('parts').parentElement;
    const bounds = scroller.getBoundingClientRect();
    const piece = next.getBoundingClientRect();
    if (piece.top < bounds.top) scroller.scrollTop += piece.top - bounds.top;
    else if (piece.bottom > bounds.bottom) scroller.scrollTop += piece.bottom - bounds.bottom;
    if (piece.left < bounds.left) scroller.scrollLeft += piece.left - bounds.left;
    else if (piece.right > bounds.right) scroller.scrollLeft += piece.right - bounds.right;
  }
  $('previous-piece').onclick = () => movePiece(-1);
  $('next-piece').onclick = () => movePiece(1);
  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'selection') {
      stale = false;
      canApply = false;
      evidence = [];
      evidenceNote = '';
      conceptTargets.clear();
      $('stale').hidden = true;
      $('error').hidden = true;
      $('evidence-section').hidden = true;
      $('source').textContent = message.code;
      originalCode = message.code;
      $('replacement').value = message.code;
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
      $('configure').textContent = message.hasKey
        ? `${message.provider} · Settings`
        : 'Connect provider';
      $('provider-status').textContent = message.hasKey
        ? `${message.provider} / ${message.model} · Ready on demand`
        : 'No API key needed for the small pieces. Connect a provider for AI help.';
      $('audience').value = saved.audience || message.audience;
      updateSettingsSummary();
    } else if (message.type === 'busy') {
      busy = message.value;
      $('progress').hidden = !busy;
      updateButtons();
    } else if (message.type === 'error') {
      $('error').textContent = message.message;
      if (message.showUsage) $('error').append(renderUsage(message));
      $('error').hidden = false;
    } else if (message.type === 'lesson') {
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
        target.replaceChildren(renderLesson(message.lesson, message, message.task === 'concept'));
      }
      updateButtons();
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
    } else if (message.type === 'preview') {
      canApply = !message.errors.length && message.replacement === $('replacement').value && !stale;
      $('preview-status').textContent = message.errors.length
        ? `Something needs fixing: ${message.errors.join(' ')} Edit your version and try again.`
        : 'Comparison opened. No syntax errors found. Code and tests have not been run.';
      updateButtons();
    } else if (message.type === 'stale') {
      stale = true;
      canApply = false;
      $('stale').hidden = false;
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
      if (evidenceNote) {
        evidenceNote =
          'Workspace changed. Compare again or request a new explanation to refresh these references.';
        $('evidence-note').textContent = evidenceNote;
      }
      updateButtons();
    } else if (message.type === 'applied') {
      canApply = false;
      focusAfterWork = true;
      $('preview-status').textContent =
        'Your file now uses this version. Compare again after further edits. Ctrl/Cmd+Z in the editor undoes the change.';
      updateButtons();
    }
  });
  post('ready');
})();
