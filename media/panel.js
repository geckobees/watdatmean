/* All code and model output is rendered as text, never as HTML. */
(() => {
  const host = window.watdatmeanHost || acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const post = (type, extra = {}) => host.postMessage({ type, ...extra });
  let busy = false;
  let stale = false;
  let tab = 'understand';
  let evidence = [];
  let evidenceNote = '';
  let canApply = false;
  let originalCode = '';
  let focusAfterWork = false;
  const conceptTargets = new Map();
  const saved = host.getState() || {};
  $('mode').value = saved.mode || 'standalone';
  let chosenMode = $('mode').value;
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function appendConceptText(parent, text, concepts) {
    const terms = concepts
      .filter((concept) => concept.term && concept.explanation)
      .slice()
      .sort((a, b) => b.term.length - a.term.length);
    const word = (character) => !!character && /[\p{L}\p{N}_]/u.test(character);
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
        'span',
        text.slice(match.index, match.index + match.concept.term.length),
        'concept-term',
      );
      term.title = match.concept.explanation;
      term.tabIndex = 0;
      term.setAttribute('aria-label', `${term.textContent}: ${match.concept.explanation}`);
      parent.append(term);
      cursor = match.index + match.concept.term.length;
    }
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
    $('preview-status').textContent = 'Back to the current code in your file. Try another change.';
    $('impact-result').replaceChildren();
    updateButtons();
    $('replacement').focus();
  };
  $('cancel').onclick = () => post('cancel');
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
      conceptTargets.clear();
      selectTab(tab);
    };
  function evidenceLink(id) {
    const entry = evidence.find((e) => e.id === id);
    const button = node('button', entry ? `${entry.file}:${entry.line}` : id, 'evidence-link');
    button.onclick = () => post('openEvidence', { id });
    return button;
  }
  function renderLesson(lesson, meta, nested = false) {
    const root = node('article', undefined, 'lesson');
    root.append(node('div', meta, 'result-meta'), node('h2', lesson.title));
    const summary = node('p');
    appendConceptText(summary, lesson.summary, lesson.concepts);
    root.append(summary);
    if (lesson.steps.length) {
      root.append(node('h3', 'Walk through it'));
      const list = node('ol');
      lesson.steps.forEach((step) => {
        const item = node('li');
        appendConceptText(item, step, lesson.concepts);
        list.append(item);
      });
      root.append(list);
    }
    if (lesson.concepts.length) {
      root.append(node('h3', 'Go a little deeper'));
      lesson.concepts.forEach((concept) => {
        const detail = node('details');
        detail.append(node('summary', concept.term), node('p', concept.explanation));
        if (!nested) {
          const target = node('div', undefined, 'concept-result');
          target.hidden = true;
          const more = node('button', 'Explain this concept ↗', 'secondary ai-action');
          more.onclick = () => {
            conceptTargets.set(concept.term, target);
            request('concept', { concept: concept.term });
          };
          detail.append(more, target);
        }
        root.append(detail);
      });
    }
    if (lesson.example.code || lesson.example.explanation) {
      root.append(node('h3', 'Put it into practice'));
      if (lesson.example.code) {
        const pre = node('pre');
        pre.append(node('code', lesson.example.code));
        root.append(pre);
      }
      const exampleExplanation = node('p');
      appendConceptText(exampleExplanation, lesson.example.explanation, lesson.concepts);
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
      root.append(node('h3', 'Things to check'));
      const list = node('ul');
      lesson.checks.forEach((check) => list.append(node('li', check)));
      root.append(list);
    }
    return root;
  }
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
      $('language').textContent = (message.language || 'TypeScript').toUpperCase();
      $('source').textContent = message.code;
      originalCode = message.code;
      $('replacement').value = message.code;
      $('location').textContent = `${message.file}:${message.line}`;
      $('preview-status').textContent = '';
      for (const id of ['explanation', 'example-result', 'impact-result', 'parts', 'evidence'])
        $(id).replaceChildren();
      $('part-detail').hidden = true;
      $('syntax-section').hidden = !message.parts.length;
      message.parts.forEach((part) => {
        const button = node('button', part.token, 'part');
        button.title = part.brief;
        button.onclick = () => {
          document.querySelectorAll('.part').forEach((p) => p.classList.remove('selected'));
          button.classList.add('selected');
          $('part-detail').hidden = false;
          $('part-detail').replaceChildren(node('strong', part.brief), node('p', part.detail));
        };
        $('parts').append(button);
      });
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
    } else if (message.type === 'busy') {
      busy = message.value;
      $('progress').hidden = !busy;
      updateButtons();
    } else if (message.type === 'error') {
      $('error').textContent = message.message;
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
        target.replaceChildren(
          renderLesson(
            message.lesson,
            `${message.cached ? 'REUSED FROM CACHE · NO NEW REQUEST' : 'AI EXPLANATION'} · ${message.provider} / ${message.model}`,
            message.task === 'concept',
          ),
        );
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
      stale = true;
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
