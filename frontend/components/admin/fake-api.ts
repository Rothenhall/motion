// A tiny stand-in for lib/api's `api()` for the admin tests. It is a plain function, not vi.fn, so a rejected promise it returns
// is not tracked by the mock library and reported as an unhandled rejection.


export interface Call { method: string; path: string; body?: any; headers?: Record<string, string> }
type Reply = unknown | ((call: Call) => unknown);
type Route = { method: string; match: string | RegExp; reply: Reply };

const state = { routes: [] as Route[], calls: [] as Call[] };

export const fakeApi = {
  calls: state.calls,
  reset() { state.routes.length = 0; state.calls.length = 0; },
  /** Answer `METHOD path` with a value, an ApiError (rejects) or a function that returns either. Later routes win. */
  on(method: string, match: string | RegExp, reply: Reply) { state.routes.unshift({ method, match, reply }); },
  called(method: string, path: string | RegExp) {
    return state.calls.filter((c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)));
  },
  async api(path: string, opts: RequestInit = {}) {
    const call: Call = { method: opts.method || 'GET', path, body: opts.body ? JSON.parse(String(opts.body)) : undefined, headers: opts.headers as Record<string, string> | undefined };
    state.calls.push(call);
    const route = state.routes.find((r) => r.method === call.method && (typeof r.match === 'string' ? r.match === path : r.match.test(path)));
    if (!route) throw Object.assign(new Error(`No fake for ${call.method} ${path}`), { status: 404 });
    const value = typeof route.reply === 'function' ? (route.reply as (c: Call) => unknown)(call) : route.reply;
    if (value instanceof Error) throw value;
    return value;
  },
};
