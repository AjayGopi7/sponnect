const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Sponnect/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('Bad JSON: ' + data.slice(0,80))); }
      });
    });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
  });
}

exports.handler = async function(event) {
  try {
    const city = event.queryStringParameters.city;
    if (!city) return { statusCode: 400, body: 'Missing city' };

    // Geocode the city
    const geoData = await httpsGet(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`
    );

    if (!geoData || !geoData[0]) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ lat: 0, lon: 0, elements: [] })
      };
    }

    const lat = geoData[0].lat;
    const lon = geoData[0].lon;

    // Smaller radius (15km) and simpler query = much faster
    const r = 15000;
    const query = `[out:json][timeout:15];(node["office"]["name"](around:${r},${lat},${lon});node["shop"]["name"](around:${r},${lat},${lon}););out tags 60;`;

    const overpassData = await httpsGet(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`
    );

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        elements: overpassData.elements || []
      })
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ lat: 0, lon: 0, elements: [], error: e.message })
    };
  }
};