if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
}
if (!window.matchMedia) {
  window.matchMedia = query => Object.assign(new EventTarget(), {
    media: query, matches: query === '(prefers-reduced-motion: reduce)', onchange: null, addListener() {}, removeListener() {},
  })
}
