// Multi-AI Code Studio: run with `node server.js` (Node 18+, no npm install needed)
const http = require('http'), fs = require('fs'), path = require('path'), { exec } = require('child_process');
try { for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] ??= m[2].trim(); } } catch {}

let WS = path.resolve(process.argv[2] || path.join(__dirname, 'workspace')); fs.mkdirSync(WS, { recursive: true }); // project folder: `node server.js "C:\my\project"` or pick it in the UI
const safe = p => { const f = path.resolve(WS, p || '.'); if (f !== WS && !f.startsWith(WS + path.sep)) throw Error('path is outside workspace'); return f; };
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (o.length >= 500) break; if (['node_modules', '__pycache__', 'venv'].includes(e.name) || e.name[0] === '.') continue; const f = path.join(d, e.name); e.isDirectory() ? walk(f, o) : o.push(path.relative(WS, f)); } return o; };

let CH = {}; // original lines of files the agent changed, used for +/- counts
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const TOOLS = [
  { name: 'list_files', description: 'List files in a workspace folder', parameters: obj({ path: { type: 'string' } }) },
  { name: 'read_file', description: 'Read a text file', parameters: obj({ path: { type: 'string' } }, ['path']) },
  { name: 'write_file', description: 'Create or overwrite a file', parameters: obj({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']) },
  { name: 'run_command', description: 'Run a shell command inside the workspace', parameters: obj({ command: { type: 'string' } }, ['command']) },
];
const SYS = 'You are a coding agent. Work only inside the workspace using your tools. Write complete working code, run it to verify when allowed, then summarise briefly what you did.';

const run = (name, a, allow) => new Promise(res => {
  try {
    if (name === 'list_files') res(fs.readdirSync(safe(a.path), { withFileTypes: true }).map(d => d.name + (d.isDirectory() ? '/' : '')).join('\n') || '(empty)');
    else if (name === 'read_file') res(fs.readFileSync(safe(a.path), 'utf8'));
    else if (name === 'write_file') { const f = safe(a.path); CH[a.path] ??= fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n') : []; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, a.content); res('written ' + a.path); }
    else if (name === 'run_command') {
      if (!allow) return res('denied: the user has not allowed command execution');
      exec(a.command, { cwd: WS, timeout: 30000 }, (e, o, r) => res((o + r + (e ? '\nexit code ' + e.code : '')).slice(-6000)));
    } else res('unknown tool');
  } catch (e) { res('error: ' + e.message); }
});

const J = async (url, headers, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const t = await r.json();
  if (!r.ok) throw Error(JSON.stringify(t.error || t).slice(0, 400));
  return t;
};
const LIMIT = '(stopped: step limit reached)';

const P = {
  async claude({ model, hist, log, allow, effort }) {
    const m = hist.map(x => ({ role: x.role, content: x.text }));
    for (let i = 0; i < 15; i++) {
      const r = await J('https://api.anthropic.com/v1/messages',
        { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: 16000, output_config: { effort: effort || 'high' }, system: SYS, messages: m, tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) });
      m.push({ role: 'assistant', content: r.content });
      const calls = r.content.filter(b => b.type === 'tool_use');
      if (!calls.length) return r.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const out = [];
      for (const c of calls) { log(c.name, c.input); out.push({ type: 'tool_result', tool_use_id: c.id, content: await run(c.name, c.input, allow) }); }
      m.push({ role: 'user', content: out });
    }
    return LIMIT;
  },
  async openai({ model, hist, log, allow }) {
    const m = [{ role: 'system', content: SYS }, ...hist.map(x => ({ role: x.role, content: x.text }))];
    for (let i = 0; i < 15; i++) {
      const r = await J('https://api.openai.com/v1/chat/completions', { authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
        { model, messages: m, tools: TOOLS.map(t => ({ type: 'function', function: t })) });
      const msg = r.choices[0].message; m.push(msg);
      if (!msg.tool_calls?.length) return msg.content || '';
      for (const c of msg.tool_calls) {
        const a = JSON.parse(c.function.arguments || '{}'); log(c.function.name, a);
        m.push({ role: 'tool', tool_call_id: c.id, content: await run(c.function.name, a, allow) });
      }
    }
    return LIMIT;
  },
  async gemini({ model, hist, log, allow }) {
    const m = hist.map(x => ({ role: x.role === 'user' ? 'user' : 'model', parts: [{ text: x.text }] }));
    for (let i = 0; i < 15; i++) {
      const r = await J(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { 'x-goog-api-key': process.env.GEMINI_API_KEY },
        { systemInstruction: { parts: [{ text: SYS }] }, contents: m, tools: [{ functionDeclarations: TOOLS }] });
      const c = r.candidates?.[0]?.content; if (!c) return '(empty response)';
      m.push(c);
      const calls = (c.parts || []).filter(p => p.functionCall);
      if (!calls.length) return (c.parts || []).map(p => p.text || '').join('');
      const out = [];
      for (const { functionCall: f } of calls) { log(f.name, f.args); out.push({ functionResponse: { name: f.name, response: { result: await run(f.name, f.args || {}, allow) } } }); }
      m.push({ role: 'user', parts: out });
    }
    return LIMIT;
  },
};
const KEYS = { claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };

http.createServer(async (q, s) => {
  const u = new URL(q.url, 'http://x');
  const send = (c, b, t = 'application/json') => { s.writeHead(c, { 'content-type': t }); s.end(typeof b === 'string' ? b : JSON.stringify(b)); };
  const body = () => new Promise(r => { let d = ''; q.on('data', c => d += c).on('end', () => r(d ? JSON.parse(d) : {})); });
  try {
    // only our own page may talk to this server (blocks other websites from running commands)
    if (!/^(localhost|127\.0\.0\.1):3000$/.test(q.headers.host || '')) return send(403, { error: 'forbidden host' });
    if (q.method === 'POST' && !(q.headers['content-type'] || '').includes('application/json')) return send(415, { error: 'json only' });
    if (u.pathname === '/api/info') return send(200, { root: WS });
    if (u.pathname === '/api/dirs') {
      const d = path.resolve(u.searchParams.get('p') || WS);
      const dirs = fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() && e.name[0] !== '.').map(e => ({ name: e.name, path: path.join(d, e.name) })).sort((a, b) => a.name.localeCompare(b.name));
      return send(200, { path: d, parent: path.dirname(d), dirs });
    }
    if (u.pathname === '/api/open') { const b = await body(), d = path.resolve(b.path); if (!fs.statSync(d).isDirectory()) throw Error('not a folder'); WS = d; return send(200, { root: WS }); }
    if (u.pathname === '/') return send(200, fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
    if (u.pathname === '/api/files') return send(200, walk(WS));
    if (u.pathname === '/api/file' && q.method === 'GET') return send(200, { content: fs.readFileSync(safe(u.searchParams.get('p')), 'utf8') });
    if (u.pathname === '/api/file') { const b = await body(); const f = safe(b.path); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b.content); return send(200, { ok: 1 }); }
    if (u.pathname === '/api/term') { const b = await body(); return send(200, { out: await run('run_command', { command: b.command }, true) }); }
    if (u.pathname === '/api/chat') {
      CH = {}; const b = await body(), steps = [], key = KEYS[b.provider];
      if (!key) return send(400, { error: 'unknown provider' });
      if (!process.env[key]) return send(400, { error: `${key} is missing. Add it to the .env file and restart.` });
      const reply = await P[b.provider]({ model: b.model, hist: b.hist, allow: b.allow, effort: b.effort, log: (n, a) => steps.push(n + ' ' + JSON.stringify(a).slice(0, 160)) });
      const changed = Object.entries(CH).map(([p, o]) => { const n = fs.readFileSync(safe(p), 'utf8').split('\n'), os = new Set(o), ns = new Set(n); return { path: p, add: n.filter(x => !os.has(x)).length, del: o.filter(x => !ns.has(x)).length }; });
      return send(200, { reply, steps, changed });
    }
    send(404, { error: 'not found' });
  } catch (e) { send(500, { error: e.message }); }
}).listen(3000, '127.0.0.1', () => console.log('Open http://localhost:3000'));
