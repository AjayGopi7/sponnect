export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/search') {
      const city = url.searchParams.get('city');
      if (!city) return new Response('Missing city', { status: 400 });

      try {
        // Search for different business types in parallel using Nominatim
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

        // Flatten, deduplicate by name
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
              tags: {
                name,
                type: item.type,
                category: item.class,
              }
            });
          }
        }

        // Get center coords
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

    return env.ASSETS.fetch(request);
  }
};