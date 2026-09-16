let token = null;
let generation = 0;
let hydration = deferred();
let hydrated = false;
let unauthorizedHandler = null;
function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); promise.catch(() => {}); return { promise, resolve, reject }; }
export function beginHydration() { token = null; generation += 1; hydrated = false; hydration = deferred(); }
export function completeHydration(nextToken) { token = nextToken || null; hydrated = true; hydration.resolve(); }
export function failHydration(error) { token = null; hydrated = false; hydration.reject(error); }
export async function awaitHydration() { if (!hydrated) await hydration.promise; }
export function setRuntimeToken(nextToken) { token = nextToken || null; generation += 1; }
export function getRuntimeSession() { return { token, generation, hydrated }; }
export function setUnauthorizedHandler(handler) { unauthorizedHandler = handler; return () => { if (unauthorizedHandler === handler) unauthorizedHandler = null; }; }
export function reportUnauthorized(observedToken) { if (observedToken && observedToken === token) unauthorizedHandler?.(observedToken); }
export function resetRuntimeForTests() { token = null; generation = 0; hydrated = false; unauthorizedHandler = null; hydration = deferred(); }
