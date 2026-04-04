export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/search') {
      const city = url.searchParams.get('city');
      if (!city) return new Response('Missing city', { status: 400 });

      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,
          { headers: { 'User-Agent': 'Sponnect/1.0' } }
        );
        const geoData = await geoRes.json();

        if (!geoData || !geoData[0]) {
          return new Response(JSON.stringify({ lat: 0, lon: 0, elements: [] }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }

        const lat = geoData[0].lat;
        const lon = geoData[0].lon;
        const query = `[out:json][timeout:10];(node["office"]["name"](around:10000,${lat},${lon});node["shop"]["name"](around:10000,${lat},${lon}););out tags 40;`;

        const overpassRes = await fetch(
          `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
        );
        const overpassData = await overpassRes.json();

        return new Response(JSON.stringify({
          lat: parseFloat(lat),
          lon: parseFloat(lon),
          elements: overpassData.elements || []
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

      } catch(e) {
        return new Response(JSON.stringify({ lat: 0, lon: 0, elements: [], error: e.message }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // Serve static files (index.html, favicons, etc)
    return env.ASSETS.fetch(request);
  }
};