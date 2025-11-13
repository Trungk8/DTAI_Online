// Cloudflare Worker — SK Mức 3 (proxy JSON → Apps Script + CORS)
const GAS_URL = 'PASTE_YOUR_APPS_SCRIPT_DEPLOY_URL_HERE'; // URL /exec của Web app
const ADMIN_SECRET = 'AUTO'; // AUTO -> worker tự sinh từ GAS_URL (không lộ trên client)

function hash(s){ let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return (h>>>0).toString(16); }

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors() });
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || '';
    const method = req.method || 'GET';
    let body = method==='GET' ? undefined : await req.text();

    if (method !== 'GET') {
      try {
        const data = JSON.parse(body||'{}');
        if (action.toLowerCase().startsWith('admin')) {
          data.adminSecret = (ADMIN_SECRET==='AUTO') ? hash('ADMIN_'+GAS_URL) : ADMIN_SECRET;
        }
        body = JSON.stringify(data);
      } catch(_){}
    }

    const target = GAS_URL + (GAS_URL.includes('?')?'&':'?') + 'action=' + encodeURIComponent(action);
    const resp = await fetch(target, { method, headers:{'content-type':'application/json'}, body });
    const text = await resp.text();
    return new Response(text, { status: resp.status, headers: cors() });
  }
}

function cors(){
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json; charset=utf-8'
  };
}
