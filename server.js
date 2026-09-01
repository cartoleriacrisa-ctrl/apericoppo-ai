const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4';
const menu = JSON.parse(fs.readFileSync(path.join(__dirname, 'menu.json'), 'utf8'));

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(__dirname));

const compactMenu = menu.filter(x => x.available !== false).map(x => ({
  id: x.id,
  categoria: x.cat,
  nome: x.name,
  descrizione: x.desc,
  prezzo: x.price,
  varianti: x.variants || [],
  allergeni: x.allergens || 'da verificare',
  vegano: !!x.vegan
}));

app.post('/api/coppo', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });
  const message = String(req.body?.message || '').trim().slice(0, 1200);
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
  if (!message) return res.status(400).json({ error: 'EMPTY_MESSAGE' });

  const instructions = `Sei “Chiedi allo Chef”, il cameriere digitale di Apericoppo, street food palermitano a Cinisi. Rispondi in italiano caldo, breve e naturale. Usa SOLO i prodotti presenti nel MENU fornito. Non inventare prodotti, prezzi, ingredienti, allergeni o disponibilità. Quando il cliente indica budget e persone, proponi una combinazione sensata che non superi il budget se possibile. Se chiede vegano, usa solo prodotti con vegano=true. Per allergie/intolleranze, non dichiarare mai un piatto sicuro: mostra solo gli allergeni registrati e invita a confermare con lo staff per contaminazioni. Se il cliente vuole prenotare, estrai persone, data e ora quando presenti. Puoi restituire product_ids per permettere al sito di aggiungere i piatti al carrello. Non usare markdown. MENU: ${JSON.stringify(compactMenu)}`;

  const input = [
    ...history.map(x => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.content || '').slice(0, 800) })),
    { role: 'user', content: message }
  ];

  const body = {
    model: OPENAI_MODEL,
    instructions,
    input,
    store: false,
    text: {
      format: {
        type: 'json_schema',
        name: 'coppo_reply',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            message: { type: 'string' },
            product_ids: { type: 'array', items: { type: 'integer' } },
            booking: {
              type: 'object',
              additionalProperties: false,
              properties: {
                requested: { type: 'boolean' },
                people: { type: ['integer','null'] },
                date: { type: ['string','null'] },
                time: { type: ['string','null'] }
              },
              required: ['requested','people','date','time']
            },
            allergy_warning: { type: 'boolean' }
          },
          required: ['message','product_ids','booking','allergy_warning']
        }
      }
    }
  };

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('OpenAI error', data);
      return res.status(502).json({ error: 'AI_UPSTREAM_ERROR' });
    }
    const text = data.output_text || data.output?.flatMap(o => o.content || []).find(c => c.type === 'output_text')?.text;
    if (!text) return res.status(502).json({ error: 'AI_EMPTY_RESPONSE' });
    const parsed = JSON.parse(text);
    parsed.product_ids = (parsed.product_ids || []).filter(id => compactMenu.some(x => x.id === id));
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI_SERVER_ERROR' });
  }
});

app.listen(PORT, () => console.log(`Apericoppo AI su http://localhost:${PORT}`));
