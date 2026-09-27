import json, time, urllib.request
T={"BRETT":"0x532f27101965dd16442e59d40670faf5ebb142e4","HOME":"0x4bfaa776991e85e5f8b1255461cbbd216cfc714f"}
now=int(time.time())//3600*3600; start=now-90*86400
for s,a in T.items():
    pts={}; st=start
    while st<now:
        u=f"https://coins.llama.fi/chart/base:{a}?start={st}&span=500&period=1h"
        d=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"pstar-research"}),timeout=60))
        pr=list(d["coins"].values())[0]["prices"] if d["coins"] else []
        if not pr: st+=500*3600; continue
        for p in pr: pts[int(p["timestamp"])//3600*3600]=p["price"]
        st=max(int(pr[-1]["timestamp"])+1, st+3600); time.sleep(0.5)
    rows=[[t,pts[t],pts[t],pts[t],pts[t],0] for t in sorted(pts)]
    json.dump(rows,open(f"data/ll_{s}_1h.json","w")); print(s,len(rows),time.strftime('%F',time.gmtime(rows[0][0])))
