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

    // ─── STATS ENDPOINT (GET) ──────────────────────────────────
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

    // ─── TRACK ENDPOINT (POST) ─────────────────────────────────
    if (url.pathname === '/track' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { type, org_name, org_type, location, sponsor_name } = body;

        if (type === 'visit') {
          const current = parseInt(await env.KV.get('stat:visits') || '191');
          await env.KV.put('stat:visits', String(current + 1));
        }

        if (type === 'search') {
          const current = parseInt(await env.KV.get('stat:searches') || '20');
          await env.KV.put('stat:searches', String(current + 1));

          if (location) {
            const city = location.split(',')[0].trim();
            const cities = JSON.parse(await env.KV.get('stat:cities') || '[]');
            if (!cities.includes(city)) {
              cities.push(city);
              await env.KV.put('stat:cities', JSON.stringify(cities));
            }
          }

          if (org_type) {
            const orgTypes = JSON.parse(await env.KV.get('stat:orgtypes') || '{}');
            orgTypes[org_type] = (orgTypes[org_type] || 0) + 1;
            await env.KV.put('stat:orgtypes', JSON.stringify(orgTypes));
          }

          const activity = JSON.parse(await env.KV.get('stat:activity') || '[]');
          activity.unshift({ type: 'search', org_name, location, ts: Date.now() });
          await env.KV.put('stat:activity', JSON.stringify(activity.slice(0, 20)));
        }

        if (type === 'email') {
          const current = parseInt(await env.KV.get('stat:emails') || '15');
          await env.KV.put('stat:emails', String(current + 1));

          const activity = JSON.parse(await env.KV.get('stat:activity') || '[]');
          activity.unshift({ type: 'email', org_name, sponsor_name, ts: Date.now() });
          await env.KV.put('stat:activity', JSON.stringify(activity.slice(0, 20)));
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

    return env.ASSETS.fetch(request);
  }
};