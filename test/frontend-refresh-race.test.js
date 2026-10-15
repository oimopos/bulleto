import assert from 'node:assert/strict';
import test from 'node:test';

class FakeClassList {
  #values = new Set();

  add(...values) {
    values.forEach((value) => this.#values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.#values.delete(value));
  }

  toggle(value, force) {
    const enabled = force === undefined ? !this.#values.has(value) : Boolean(force);
    if (enabled) this.#values.add(value);
    else this.#values.delete(value);
    return enabled;
  }
}

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.textContent = '';
    this.value = id === 'risk-rounds' ? '0' : '';
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type });
  }

  append() {}
  appendChild() {}
  replaceChildren() {}
  remove() {}
  setAttribute() {}
  removeAttribute() {}
  querySelectorAll() { return []; }
  closest() { return null; }
}

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances = [];

  constructor() {
    this.readyState = FakeEventSource.CONNECTING;
    this.listeners = new Map();
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, data = '{}') {
    if (type === 'open') this.readyState = FakeEventSource.OPEN;
    if (type === 'error' && this.readyState !== FakeEventSource.CLOSED) {
      this.readyState = FakeEventSource.CONNECTING;
    }
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, data });
    }
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

function fakeResponse(payload = {}) {
  return {
    ok: true,
    async json() {
      return payload;
    },
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test('SSE revisions keep an in-flight response stale and queue a post-event refresh', async (t) => {
  const originalGlobals = {
    document: globalThis.document,
    EventSource: globalThis.EventSource,
    fetch: globalThis.fetch,
    window: globalThis.window,
  };
  const elements = new Map();
  const windowListeners = new Map();
  const pendingFetches = [];
  let fetchCount = 0;

  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  const document = {
    visibilityState: 'visible',
    getElementById: element,
    querySelector: (selector) => element(selector),
    createElement: (tag) => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement('fragment'),
    addEventListener() {},
  };
  const window = {
    EventSource: FakeEventSource,
    performance: globalThis.performance,
    setTimeout(callback, delay) {
      const timer = setTimeout(callback, delay);
      timer.unref?.();
      return timer;
    },
    clearTimeout,
    setInterval() { return 0; },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
  };

  globalThis.document = document;
  globalThis.EventSource = FakeEventSource;
  globalThis.window = window;
  globalThis.fetch = (url) => {
    fetchCount += 1;
    return new Promise((resolve) => pendingFetches.push({ resolve, url }));
  };
  FakeEventSource.instances.length = 0;

  t.after(() => {
    windowListeners.get('beforeunload')?.();
    globalThis.document = originalGlobals.document;
    globalThis.EventSource = originalGlobals.EventSource;
    globalThis.fetch = originalGlobals.fetch;
    globalThis.window = originalGlobals.window;
  });

  await import(`../public/app.js?refresh-race=${Date.now()}`);
  assert.equal(fetchCount, 8, 'boot must start exactly one eight-request refresh');
  const source = FakeEventSource.instances[0];
  assert.ok(source);

  source.emit('open');
  source.emit('update', JSON.stringify({ reason: 'results' }));
  pendingFetches.splice(0, 8).forEach(({ resolve }) => resolve(fakeResponse()));

  await waitFor(
    () => fetchCount === 16,
    'an SSE event during the first refresh must queue a second complete refresh',
  );
  assert.equal(
    element('preclose-panel').dataset.state,
    'stale',
    'the pre-event response must remain fail-closed while the queued refresh is pending',
  );

  pendingFetches.splice(0, 8).forEach(({ resolve }) => resolve(fakeResponse()));
  await waitFor(
    () => element('preclose-panel').dataset.state === 'waiting',
    'the post-event response should become current while the same SSE revision stays open',
  );

  source.emit('error');
  assert.equal(
    element('preclose-panel').dataset.state,
    'stale',
    'SSE loss must invalidate a fresh state snapshot even when the leader endpoint is already stale',
  );

  element('refresh-button').dispatch('click');
  assert.equal(fetchCount, 24, 'manual recovery starts one refresh while SSE reconnects');
  source.emit('open');
  pendingFetches.splice(0, 8).forEach(({ resolve }) => resolve(fakeResponse()));

  await waitFor(
    () => fetchCount === 32,
    'an SSE reconnect during a request must queue a post-open refresh',
  );
  assert.equal(
    element('preclose-panel').dataset.state,
    'stale',
    'a response started before reconnect must not be accepted as live-current',
  );

  pendingFetches.splice(0, 8).forEach(({ resolve }) => resolve(fakeResponse()));
  await waitFor(
    () => element('preclose-panel').dataset.state === 'waiting',
    'only the response started after reconnect may clear the stale state',
  );
});
