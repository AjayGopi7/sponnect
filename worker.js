function sanitize(str) {
  if (!str) return str;
  return String(str).replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c]));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/search') {
      const city = url.searchParams.get('city');
      if (!city) return new Response('Missing city', { status: 400 });
      try {
        const cityName = city.split(',')[0].trim();
        const searches = [`office in ${cityName}`,`store in ${cityName}`,`restaurant in ${cityName}`,`bank in ${cityName}`,`clinic in ${cityName}`];
        const results = await Promise.all(searches.map(q => fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=10&addressdetails=0`,{headers:{'User-Agent':'Sponnect/1.0'}}).then(r=>r.json()).catch(()=>[])));
        const seen = new Set();
        const elements = [];
        for (const group of results) for (const item of group) { const name = item.name||item.display_name?.split(',')[0]; if(!name||seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase()); elements.push({lat:parseFloat(item.lat),lon:parseFloat(item.lon),tags:{name,type:item.type,category:item.class}}); }
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`,{headers:{'User-Agent':'Sponnect/1.0'}});
        const geoData = await geoRes.json();
        return new Response(JSON.stringify({lat:geoData[0]?parseFloat(geoData[0].lat):0,lon:geoData[0]?parseFloat(geoData[0].lon):0,elements}),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      } catch(e) { return new Response(JSON.stringify({lat:0,lon:0,elements:[],error:e.message}),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}}); }
    }

    if (url.pathname === '/stats' && request.method === 'GET') {
      try {
        const [visits,searches,emails,citiesRaw,activityRaw,orgTypesRaw] = await Promise.all([env.KV.get('stat:visits'),env.KV.get('stat:searches'),env.KV.get('stat:emails'),env.KV.get('stat:cities'),env.KV.get('stat:activity'),env.KV.get('stat:orgtypes')]);
        return new Response(JSON.stringify({visits:parseInt(visits||'191'),searches:parseInt(searches||'20'),emails:parseInt(emails||'15'),cities:citiesRaw?JSON.parse(citiesRaw):[],activity:activityRaw?JSON.parse(activityRaw):[],orgTypes:orgTypesRaw?JSON.parse(orgTypesRaw):{}}),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      } catch(e) { return new Response(JSON.stringify({error:e.message}),{status:500,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}}); }
    }

    if (url.pathname === '/track' && request.method === 'POST') {
      try {
        const body = await request.json();
        const {type,org_name,org_type,location,sponsor_name} = body;
        
        const cleanOrgName = sanitize(org_name);
        const cleanOrgType = sanitize(org_type);
        const cleanLocation = sanitize(location);
        const cleanSponsorName = sanitize(sponsor_name);

        if (type==='visit') { const c=parseInt(await env.KV.get('stat:visits')||'191'); await env.KV.put('stat:visits',String(c+1)); }
        if (type==='search') {
          const [cRaw,otRaw,aRaw,sRaw] = await Promise.all([env.KV.get('stat:cities'),env.KV.get('stat:orgtypes'),env.KV.get('stat:activity'),env.KV.get('stat:searches')]);
          const c=parseInt(sRaw||'20'),cities=JSON.parse(cRaw||'[]'),orgTypes=JSON.parse(otRaw||'{}'),activity=JSON.parse(aRaw||'[]');
          const p=[env.KV.put('stat:searches',String(c+1))];
          
          if(cleanLocation){
            const city = cleanLocation.split(',')[0].trim();
            if(!city.includes('&lt;script') && !city.includes('&lt;img') && !cities.includes(city)){
              cities.push(city);
              p.push(env.KV.put('stat:cities',JSON.stringify(cities)));
            }
          }
          if(cleanOrgType){orgTypes[cleanOrgType]=(orgTypes[cleanOrgType]||0)+1;p.push(env.KV.put('stat:orgtypes',JSON.stringify(orgTypes)));}
          
          activity.unshift({type:'search', org_name: cleanOrgName, location: cleanLocation, ts:Date.now()});
          p.push(env.KV.put('stat:activity',JSON.stringify(activity.slice(0,20))));
          await Promise.all(p);
        }
        if (type==='email') {
          const [eRaw,aRaw]=await Promise.all([env.KV.get('stat:emails'),env.KV.get('stat:activity')]);
          const c=parseInt(eRaw||'15'),activity=JSON.parse(aRaw||'[]');
          
          activity.unshift({type:'email', org_name: cleanOrgName, sponsor_name: cleanSponsorName, ts:Date.now() });
          await Promise.all([env.KV.put('stat:emails',String(c+1)),env.KV.put('stat:activity',JSON.stringify(activity.slice(0,20)))]);
        }
        return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      } catch(e) { return new Response(JSON.stringify({error:e.message}),{status:500,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}}); }
    }

    if (request.method==='OPTIONS') return new Response(null,{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});

    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      let html = await response.text();
      html = html.replace(/<script\b[^>]+src=["'](?!https:\/\/fonts\.googleapis\.com)[^"']*["'][^>]*>\s*<\/script>/gi, '');
      html = html.replace(/<script\b[^>]*>(?:[^<]|<(?!\/script>))*(?:googletagmanager|gtag|dataLayer|youtube|youtu\.be|window\.location)(?:[^<]|<(?!\/script>))*<\/script>/gi, '');
      html = html.replace('</body>', `<script>if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(r=>r.forEach(sw=>sw.unregister()));}</script></body>`);
      const h = new Headers(response.headers);
      h.delete('content-length');
      h.set('X-Content-Type-Options', 'nosniff');
      h.set('X-Frame-Options', 'DENY');
      h.set('Content-Security-Policy', "default-src 'self' 'unsafe-inline' fonts.googleapis.com fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self' https://nominatim.openstreetmap.org https://pxsmauckzsntbihidgoa.supabase.co;");
      return new Response(html, {status: response.status, headers: h});
    }

    return response;
  }
};