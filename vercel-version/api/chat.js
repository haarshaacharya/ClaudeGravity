// Vercel serverless proxy: keeps your API keys on the server and checks an access password.
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const pw = process.env.ACCESS_PASSWORD;
    if (!pw || req.headers['x-access-password'] !== pw) return res.status(401).json({ error: 'unauthorized' });
    const { provider, model, payload } = req.body || {};
    const name = { claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' }[provider];
    if (!name) return res.status(400).json({ error: 'unknown provider' });
    const key = process.env[name];
    if (!key) return res.status(400).json({ error: name + ' is not set in Vercel Environment Variables' });
    let url, headers = { 'content-type': 'application/json' };
    if (provider === 'claude') { url = 'https://api.anthropic.com/v1/messages'; headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
    else if (provider === 'openai') { url = 'https://api.openai.com/v1/chat/completions'; headers.authorization = 'Bearer ' + key; }
    else {
      if (!/^[\w.\-]+$/.test(model || '')) return res.status(400).json({ error: 'bad model name' });
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`; headers['x-goog-api-key'] = key;
    }
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const t = await r.json().catch(() => ({ error: 'bad response from provider' }));
    res.status(r.status).json(t);
  } catch (e) { res.status(500).json({ error: e.message }); }
};
