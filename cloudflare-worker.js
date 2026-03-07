/**
 * InVault — Cloudflare Worker
 * Actúa como proxy CORS para la API oEmbed de Instagram.
 *
 * DESPLIEGUE (gratis, 2 minutos):
 * 1. Ve a https://workers.cloudflare.com
 * 2. Crea cuenta gratuita (o inicia sesión)
 * 3. Clic en "Create a Worker"
 * 4. Borra el código de ejemplo y pega TODO este archivo
 * 5. Clic en "Save and Deploy"
 * 6. Copia la URL que te da (ej: https://invault-proxy.TU_USUARIO.workers.dev)
 * 7. Pégala en app.js donde dice CLOUDFLARE_WORKER_URL
 *
 * Plan gratuito: 100,000 requests/día — más que suficiente para uso personal.
 */

export default {
  async fetch(request) {
    // Allow CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const { searchParams } = new URL(request.url);
    const igUrl = searchParams.get('url');

    if (!igUrl) {
      return json({ error: 'Missing url param' }, 400);
    }

    // Only allow Instagram URLs
    if (!igUrl.includes('instagram.com')) {
      return json({ error: 'Only Instagram URLs allowed' }, 403);
    }

    const oembedUrl =
      `https://api.instagram.com/oembed/?url=${encodeURIComponent(igUrl)}&maxwidth=320&omitscript=true`;

    try {
      const res = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.instagram.com/',
          'Origin': 'https://www.instagram.com',
        },
        redirect: 'follow',
      });

      const text = await res.text();

      // Instagram sometimes returns HTML (login page) instead of JSON
      if (text.trim().startsWith('<')) {
        return json({ error: 'Instagram returned HTML — post may be private' }, 422);
      }

      const data = JSON.parse(text);
      return json(data);
    } catch (err) {
      return json({ error: err.message }, 502);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'public, max-age=86400', // Cache 24h
  };
}
