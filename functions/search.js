export async function onRequest(context) {
  const url = new URL(context.request.url);
  const city = url.searchParams.get('city');

  if (!city) {
    return new Response(JSON.stringify({ error: 'Missing city' }), { status: 400 });
  }

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
    const query = `[out:json][timeout:25];(node["office"]["name"](around:40000,${lat},${lon});node["shop"]["name"](around:40000,${lat},${lon});node["amenity"~"restaurant|cafe|clinic|bank"]["name"](around:40000,${lat},${lon});way["office"]["name"](around:40000,${lat},${lon}););out tags center 120;`;

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