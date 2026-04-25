export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/stats') {
      try {
        // Test if KV binding exists
        if (!env.KV) {
          return new Response(JSON.stringify({ error: 'KV binding not found', envKeys: Object.keys(env) }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
        
        // Test basic KV read
        const test = await env.KV.get('test');
        return new Response(JSON.stringify({ ok: true, kvWorks: true, testValue: test }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};