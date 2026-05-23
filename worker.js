export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ─── SEARCH ENDPOINT ───────────────────────────────────────
    if (url.pathname === '/search') {
      const city = url.searchParams.get('city');
      if (!city) return new Response('Missing city', { status: 400 });
      try {
        const cityName = city.split(',')[0].trim();
        const searches = [
          `office in ${cityName}`,
          `store in ${cityName}`,
          `restaurant in ${cityName}`,
          `bank in ${cityName}`,
          `clinic in ${cityName}`,
        ];
        const results = await Promise.all(
          searches.map(q =>
            fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=10&addressdetails=0`, {
              headers: { 'User-Agent': 'Sponnect/1.0' }
            }).then(r => r.json()).catch(() => [])
          )
        );
        const seen = new Set();
        const elements = [];
        for (const group of results) {
          for (const item of group) {
            const name = item.name || item.display_name?.split(',')[0];
            if (!name || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            elements.push({
              lat: parseFloat(item.lat),
              lon: parseFloat(item.lon),
              tags: { name, type: item.type, category: item.class }
            });
          }
        }
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
          { headers: { 'User-Agent': 'Sponnect/1.0' } }
        );
        const geoData = await geoRes.json();
        const lat = geoData[0] ? parseFloat(geoData[0].lat) : 0;
        const lon = geoData[0] ? parseFloat(geoData[0].lon) : 0;
        return new Response(JSON.stringify({ lat, lon, elements }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch(e) {
        return new Response(JSON.stringify({ lat: 0, lon: 0, elements: [], error: e.message }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // ─── STATS ENDPOINT ────────────────────────────────────────
    if (url.pathname === '/stats' && request.method === 'GET') {
      try {
        const [visits, searches, emails, citiesRaw, activityRaw, orgTypesRaw] = await Promise.all([
          env.KV.get('stat:visits'),
          env.KV.get('stat:searches'),
          env.KV.get('stat:emails'),
          env.KV.get('stat:cities'),
          env.KV.get('stat:activity'),
          env.KV.get('stat:orgtypes'),
        ]);
        return new Response(JSON.stringify({
          visits:   parseInt(visits   || '191'),
          searches: parseInt(searches || '20'),
          emails:   parseInt(emails   || '15'),
          cities:   citiesRaw   ? JSON.parse(citiesRaw)   : [],
          activity: activityRaw ? JSON.parse(activityRaw) : [],
          orgTypes: orgTypesRaw ? JSON.parse(orgTypesRaw) : {},
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // ─── TRACK ENDPOINT ────────────────────────────────────────
    if (url.pathname === '/track' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { type, org_name, org_type, location, sponsor_name } = body;

        if (type === 'visit') {
          const current = parseInt(await env.KV.get('stat:visits') || '191');
          await env.KV.put('stat:visits', String(current + 1));
        }

        if (type === 'search') {
          // OPTIMIZATION: Fetch existing data bundles concurrently
          const [citiesRaw, orgTypesRaw, activityRaw, currentSearches] = await Promise.all([
            env.KV.get('stat:cities'),
            env.KV.get('stat:orgtypes'),
            env.KV.get('stat:activity'),
            env.KV.get('stat:searches')
          ]);

          const current = parseInt(currentSearches || '20');
          const cities = JSON.parse(citiesRaw || '[]');
          const orgTypes = JSON.parse(orgTypesRaw || '{}');
          const activity = JSON.parse(activityRaw || '[]');

          const promises = [env.KV.put('stat:searches', String(current + 1))];

          if (location) {
            const city = location.split(',')[0].trim();
            if (!cities.includes(city)) {
              cities.push(city);
              promises.push(env.KV.put('stat:cities', JSON.stringify(cities)));
            }
          }
          if (org_type) {
            orgTypes[org_type] = (orgTypes[org_type] || 0) + 1;
            promises.push(env.KV.put('stat:orgtypes', JSON.stringify(orgTypes)));
          }

          activity.unshift({ type: 'search', org_name, location, ts: Date.now() });
          promises.push(env.KV.put('stat:activity', JSON.stringify(activity.slice(0, 20))));

          await Promise.all(promises);
        }

        if (type === 'email') {
          const [currentEmails, activityRaw] = await Promise.all([
            env.KV.get('stat:emails'),
            env.KV.get('stat:activity')
          ]);

          const current = parseInt(currentEmails || '15');
          const activity = JSON.parse(activityRaw || '[]');
          
          activity.unshift({ type: 'email', org_name, sponsor_name, ts: Date.now() });

          await Promise.all([
            env.KV.put('stat:emails', String(current + 1)),
            env.KV.put('stat:activity', JSON.stringify(activity.slice(0, 20)))
          ]);
        }

        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch(e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // ─── CORS PREFLIGHT ────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    // ─── SERVE HTML WITH SCRIPT INJECTION PROTECTION ───────────
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      let html = await response.text();
      
      // Strip external scripts
      html = html.replace(/<script\b[^>]*src=["'][^"']*googletagmanager[^"']*["'][^>]*><\/script>/gi, '');
      html = html.replace(/<script\b[^>]*src=["'][^"']*google-analytics[^"']*["'][^>]*><\/script>/gi, '');
      
      // Strip inline GA scripts
      html = html.replace(/<script\b[^>]*>[\s\S]*?gtag[\s\S]*?<\/script>/gi, '');
      html = html.replace(/<script\b[^>]*>[\s\S]*?dataLayer[\s\S]*?<\/script>/gi, '');

      // Inject service worker killer before </body>
      const swKiller = `
      <script>
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
          registrations.forEach(function(registration) {
            registration.unregister();
            console.log('Killed SW:', registration.scope);
          });
        });
      }
      </script>`;
      
      html = html.replace('</body>', swKiller + '</body>');
      
      // FIX: Clone headers and strip content-length to prevent truncated page deliveries
      const newHeaders = new Headers(response.headers);
      newHeaders.delete('content-length');

      return new Response(html, {
        status: response.status,
        headers: newHeaders,
      });
    }

    return response;
  }
};