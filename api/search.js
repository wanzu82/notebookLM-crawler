export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const serpKey = process.env.SERP_API_KEY;

  if (!anthropicKey) return res.status(500).json({ error: 'Anthropic API key not configured.' });
  if (!serpKey) return res.status(500).json({ error: 'SerpAPI key not configured.' });

  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'No query provided.' });

  try {
    const searchQueries = [
      `NotebookLM prompt "${query}" slide deck design structure`,
      `NotebookLM infographic prompt template design layout site:reddit.com OR site:medium.com`,
      `best NotebookLM prompts presentation design 2024 2025`
    ];

    const searchResults = [];

    for (const q of searchQueries) {
      const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(q)}&api_key=${serpKey}&num=5&engine=google`;
      const serpRes = await fetch(serpUrl);
      const serpData = await serpRes.json();
      if (serpData.organic_results) {
        for (const result of serpData.organic_results.slice(0, 4)) {
          searchResults.push({
            title: result.title || '',
            snippet: result.snippet || '',
            url: result.link || '',
            source: extractDomain(result.link || '')
          });
        }
      }
    }

    if (searchResults.length === 0) {
      return res.status(200).json({ results: [], message: 'No results found. Try different keywords.' });
    }

    const context = searchResults.map((r, i) =>
      `[${i+1}] SOURCE: ${r.source}\nURL: ${r.url}\nTITLE: ${r.title}\nSNIPPET: ${r.snippet}`
    ).join('\n\n');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: `You extract NotebookLM prompts from real web search results. Focus ONLY on prompts about DESIGN, LAYOUT, and STRUCTURE of slide decks and infographics — not topic content.

Return ONLY a raw JSON array. No markdown. No code fences. No apostrophes in any string value.

Each object must have exactly:
- id: string like "p001"
- title: max 6 words describing the design style
- prompt: the actual design prompt to paste into NotebookLM (2-4 sentences about layout and structure, no apostrophes)
- type: exactly "slide" or "infographic" or "both"
- source_name: website name like "Reddit" or "Medium" or "YouTube"
- source_url: the actual URL from the search result
- score: integer 1-10
- style: one word like "minimal" or "corporate" or "academic" or "visual" or "data-heavy"
- tags: array of exactly 2 plain word strings

Return 6-8 objects. Start with [ end with ]. No other text whatsoever.`,
        messages: [{
          role: 'user',
          content: `Extract NotebookLM design and structure prompts from these real search results about "${query}":\n\n${context}`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text || '[]';

    let parsed = [];
    try {
      let clean = raw.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('[');
      const end = clean.lastIndexOf(']');
      if (start !== -1 && end !== -1) clean = clean.slice(start, end + 1);
      clean = clean.replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(clean);
    } catch(e) {
      return res.status(500).json({ error: 'Parse failed: ' + e.message });
    }

    parsed = parsed.map((p, i) => ({
      ...p,
      source_url: p.source_url || searchResults[i % searchResults.length]?.url || '',
      source_name: p.source_name || searchResults[i % searchResults.length]?.source || 'Web'
    }));

    return res.status(200).json({ results: parsed, sources_scanned: searchResults.length });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function extractDomain(url) {
  try {
    const d = new URL(url).hostname.replace('www.', '');
    if (d.includes('reddit')) return 'Reddit';
    if (d.includes('medium')) return 'Medium';
    if (d.includes('youtube')) return 'YouTube';
    if (d.includes('github')) return 'GitHub';
    if (d.includes('substack')) return 'Substack';
    if (d.includes('linkedin')) return 'LinkedIn';
    return d;
  } catch { return 'Web'; }
}
