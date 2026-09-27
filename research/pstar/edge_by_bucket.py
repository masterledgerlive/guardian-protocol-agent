import backtest as b, json, numpy as np
pools=json.load(open('data/pools.json')); out={}
for tf in ["15m","1h"]:
    trs=[]
    for s in b.TOKENS:
        f,_=b.src_path(s,tf)
        if f: trs+=b.simulate(s,tf,pools[s]["liqUsd"])[0]
    ps=np.array([x["p"] for x in trs]); edges,_=b.merged_edges(ps); rows=[]
    print(tf, "n",len(trs))
    for i in range(len(edges)-1):
        idx=[k for k,x in enumerate(trs) if edges[i]<=x["p"]<edges[i+1]]
        r=np.array([trs[k]["r"] for k in idx]); fee=np.array([trs[k]["fee"] for k in idx]); sb=np.array([trs[k]["sb"] for k in idx])
        tp=float(np.mean([trs[k]["tp_hit"] for k in idx]))
        row=dict(lo=edges[i],hi=None if edges[i+1]==float('inf') else edges[i+1],n=len(idx),mean_gross=float(r.mean()),se=float(r.std()/np.sqrt(len(r))),tp_rate=tp,fee=float(fee.mean()),volslip_rt=float((0.5*sb).mean()),edge_per_unit=float((r-fee-0.5*sb).mean()))
        rows.append(row); print("  ",{k:(round(v,4) if isinstance(v,float) else v) for k,v in row.items()})
    r=np.array([x["r"] for x in trs]); print("  all mean gross %.4f se %.4f"%(r.mean(), r.std()/np.sqrt(len(r))))
    out[tf]=dict(rows=rows, all_mean_gross=float(r.mean()), all_se=float(r.std()/np.sqrt(len(r))))
json.dump(out,open('results/edge_by_bucket.json','w'),indent=1)
