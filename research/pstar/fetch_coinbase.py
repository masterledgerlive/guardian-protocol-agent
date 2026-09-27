import json, time, urllib.request
P={"WETH":"ETH-USD","AERO":"AERO-USD","DEGEN":"DEGEN-USD","TOSHI":"TOSHI-USD","VIRTUAL":"VIRTUAL-USD"}
now=int(time.time())//900*900; start=now-90*86400
for tf,g in [("15m",900),("1h",3600)]:
    for s,prod in P.items():
        bars={}; end=now
        while end>start:
            st=max(start,end-300*g)
            u=f"https://api.exchange.coinbase.com/products/{prod}/candles?granularity={g}&start={st}&end={end}"
            for i in range(5):
                try:
                    d=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"pstar-research"}),timeout=30)); break
                except Exception as e: time.sleep(3*(i+1))
            for r in d: bars[int(r[0])]=[int(r[0]),r[3],r[2],r[1],r[4],r[5]]
            end=st; time.sleep(0.35)
        rows=[bars[k] for k in sorted(bars) if k>=start]
        json.dump(rows,open(f"data/cb_{s}_{tf}.json","w"))
        print(s,tf,len(rows),flush=True)
