const http = require("http");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const SYMBOL = process.env.PENGU_SYMBOL || "PENGUUSDT";
const clients = new Set();
const state = {
  symbol: SYMBOL, price: null, ticker: null, trades: [],
  candles: {"1m": [], "5m": [], "15m": []},
  connected: false, lastPacket: 0
};

let bitunix = null;
let reconnectTimer = null;

function send(client, payload) {
  client.write(`data: ${JSON.stringify(payload)}\n\n`);
}
function broadcast() {
  const payload = { type:"snapshot", serverTime:Date.now(), ...state };
  for (const c of clients) send(c, payload);
}

async function history(interval) {
  const u = `https://fapi.bitunix.com/api/v1/futures/market/kline?symbol=${SYMBOL}&interval=${interval}&limit=200`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Bitunix history HTTP ${r.status}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg || "Bitunix history error");
  return (j.data || []).map(x => ({
    o:+x.open, h:+x.high, l:+x.low, c:+x.close,
    q:+x.quoteVol, b:+x.baseVol, t:+x.time
  })).sort((a,b)=>a.t-b.t);
}

async function loadHistory() {
  for (const tf of ["1m","5m","15m"]) state.candles[tf] = await history(tf);
  broadcast();
}

function connectBitunix() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try {
    bitunix = new WebSocket("wss://fapi.bitunix.com/public/");
    bitunix.addEventListener("open", () => {
      state.connected = true;
      const args = [
        {symbol:SYMBOL, ch:"market_kline_1min"},
        {symbol:SYMBOL, ch:"market_kline_5min"},
        {symbol:SYMBOL, ch:"market_kline_15min"},
        {symbol:SYMBOL, ch:"ticker"},
        {symbol:SYMBOL, ch:"trade"}
      ];
      bitunix.send(JSON.stringify({op:"subscribe", args}));
      broadcast();
    });
    bitunix.addEventListener("message", e => {
      try {
        const m = JSON.parse(typeof e.data === "string" ? e.data : Buffer.from(e.data).toString());
        state.lastPacket = Date.now();

        if (m.ch?.startsWith("market_kline_")) {
          const tf = {"market_kline_1min":"1m","market_kline_5min":"5m","market_kline_15min":"15m"}[m.ch];
          if (tf) {
            const d=m.data||{};
            const c={o:+d.o,h:+d.h,l:+d.l,c:+d.c,q:+d.q,b:+d.b,t:+m.ts};
            const a=state.candles[tf];
            if (a.length && a[a.length-1].t===c.t) a[a.length-1]=c;
            else a.push(c);
            state.candles[tf]=a.slice(-200);
            state.price=c.c;
          }
        } else if (m.ch==="ticker") {
          state.ticker=m.data;
          state.price=+m.data.la;
        } else if (m.ch==="trade") {
          const list=Array.isArray(m.data)?m.data:[m.data];
          state.trades=[
            ...list.map(x=>({p:+x.p,v:+x.v,s:x.s,t:x.t})),
            ...state.trades
          ].slice(0,300);
          if (!state.price && list.length) state.price=+list.at(-1).p;
        }
        broadcast();
      } catch {}
    });
    bitunix.addEventListener("close", () => {
      state.connected=false; broadcast();
      reconnectTimer=setTimeout(connectBitunix,1000);
    });
    bitunix.addEventListener("error", () => {});
  } catch {
    state.connected=false; broadcast();
    reconnectTimer=setTimeout(connectBitunix,1000);
  }
}

const server=http.createServer(async (req,res)=>{
  const u=new URL(req.url, `http://${req.headers.host}`);

  if (u.pathname==="/health") {
    res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});
    return res.end(JSON.stringify({
      ok:true, bitunixConnected:state.connected,
      lastPacket:state.lastPacket, clients:clients.size
    }));
  }

  if (u.pathname==="/api/snapshot") {
    res.writeHead(200,{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"*"});
    return res.end(JSON.stringify(state));
  }

  if (u.pathname==="/stream") {
    res.writeHead(200,{
      "content-type":"text/event-stream",
      "cache-control":"no-cache, no-store, must-revalidate",
      "connection":"keep-alive",
      "access-control-allow-origin":"*",
      "x-accel-buffering":"no"
    });
    res.write("retry: 1000\n\n");
    clients.add(res);
    send(res,{type:"snapshot",serverTime:Date.now(),...state});
    req.on("close",()=>clients.delete(res));
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, async ()=>{
  console.log(`PENGU backend listening on ${PORT}`);
  try { await loadHistory(); } catch(e) { console.error(e.message); }
  connectBitunix();
});
