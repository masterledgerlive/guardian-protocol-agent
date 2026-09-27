"""Market threshold p*_mkt backtest — implements docs/MARKET_THRESHOLD_PREREG.md (commit cbfdaad9).
Paper research only. Reads data/{,cb_,ll_}SYM_TF.json (GeckoTerminal if present, else Coinbase, else
DefiLlama close-only; see fetch_*.py) + data/pools.json, writes results/*.json."""
import json, math, os, sys
import numpy as np

B = 5.0
TIERS = [1, 3, 5, 10, 25]
GAS_RT = 0.12
EDGES = [0, 0.02, 0.03, 0.04, 0.05, 0.06, 0.075, 0.09, 0.105, 0.12, 0.15, 0.20, math.inf]
CFG = {  # (round-trip pool fee, TP gross) per prereg §3/§5
    "TOSHI": (0.02, 0.06),
}
DEFAULT = (0.006, 0.031)
TOKENS = ["AERO", "BRETT", "DEGEN", "TOSHI", "VIRTUAL", "HOME", "WETH"]

SOURCES = [("", "GeckoTerminal"), ("cb_", "Coinbase"), ("ll_", "DefiLlama-close-only")]
def src_path(sym, tf):
    for pre, name in SOURCES:
        f = f"data/{pre}{sym}_{tf}.json"
        if os.path.exists(f): return f, name
    return None, None

def load(sym, tf):
    rows = json.load(open(src_path(sym, tf)[0]))
    step = 900 if tf == "15m" else 3600
    # forward-fill missing bars (no trade = flat bar at prior close)
    out = []; prev = None
    for r in rows:
        t = int(r[0])
        if prev is not None:
            tt = prev[0] + step
            while tt < t:
                c = prev[4]; out.append([tt, c, c, c, c, 0.0]); tt += step
        row = [t] + [float(x) for x in r[1:6]]
        out.append(row); prev = row
    a = np.array(out, dtype=float)
    return a

def rsi(c, n=14):
    d = np.diff(c, prepend=c[0]); up = np.clip(d, 0, None); dn = np.clip(-d, 0, None)
    au = np.zeros_like(c); ad = np.zeros_like(c)
    au[n] = up[1:n+1].mean(); ad[n] = dn[1:n+1].mean()
    for i in range(n+1, len(c)):
        au[i] = (au[i-1]*(n-1) + up[i]) / n; ad[i] = (ad[i-1]*(n-1) + dn[i]) / n
    rs = np.where(ad > 0, au / np.maximum(ad, 1e-300), np.inf)
    out = 100 - 100/(1+rs); out[:n] = 50
    return out

def params(tf):
    if tf == "15m": return dict(win=96, trough=16, pull=96, hold=192, scale=math.sqrt(96))
    return dict(win=24, trough=4, pull=24, hold=48, scale=math.sqrt(24))

def vol_series(c, win, scale):
    lr = np.diff(np.log(c), prepend=np.log(c[0]))
    p = np.full(len(c), np.nan)
    cs = np.concatenate([[0], np.cumsum(lr)]); cs2 = np.concatenate([[0], np.cumsum(lr*lr)])
    for t in range(win, len(c)):
        # returns ending at bar t inclusive: lr[t-win+1..t]
        s = cs[t+1]-cs[t+1-win]; s2 = cs2[t+1]-cs2[t+1-win]
        var = (s2 - s*s/win)/(win-1)
        p[t] = math.sqrt(max(var, 0)) * scale
    return p, lr

def simulate(sym, tf, liq):
    a = load(sym, tf); t, o, h, l, c = a[:,0], a[:,1], a[:,2], a[:,3], a[:,4]
    P = params(tf); fee, tp = CFG.get(sym, DEFAULT)
    p, lr = vol_series(c, P["win"], P["scale"]); R = rsi(c)
    trades = []; i = max(P["win"], P["pull"]) + 1; n = len(c)
    while i < n - 2:
        sb = p[i] / P["scale"]
        trough = c[i] <= 1.005 * l[i-P["trough"]:i].min()
        mom = R[i] <= 35
        pull = c[i] <= 0.97 * h[i-P["pull"]:i].max()
        falling = lr[i] < -3 * sb
        if (int(trough) + int(mom) + int(pull)) >= 2 and not falling and p[i] > 0:
            e = o[i+1]; tgt = e * (1 + tp); end = min(i + P["hold"], n - 1)
            ex = None; k = i + 1
            while k <= end:
                if h[k] >= tgt: ex = tgt; break
                k += 1
            if ex is None: k = end; ex = c[end]
            full = (end == i + P["hold"]) or ex == tgt
            r = ex / e - 1
            # cascade layers (secondary)
            casc = {}
            for d in [1, 3, 5]:
                levels = [e * (1 - 0.03*j) for j in range(d)]; filled = [True] + [False]*(d-1)
                kk = i + 1; exc = None
                while kk <= end:
                    nf = sum(filled); inv = B*nf
                    qty = sum(B/lv for lv, f in zip(levels, filled) if f); avgc = inv/qty
                    if h[kk] >= avgc*(1+tp): exc = avgc*(1+tp); break
                    for j in range(1, d):
                        if not filled[j] and l[kk] <= levels[j]: filled[j] = True
                    kk += 1
                nf = sum(filled); inv = B*nf; qty = sum(B/lv for lv, f in zip(levels, filled) if f)
                if exc is None: exc = c[end]
                casc[d] = dict(layers=nf, gross_usd=qty*exc - inv, notional=inv)
            trades.append(dict(sym=sym, t=int(t[i+1]), p=float(p[i]), sb=float(sb), r=float(r),
                               tp_hit=bool(ex == tgt), bars=int(k-i), complete=bool(full), fee=fee, liq=liq, casc=casc))
            i = k + 1
        else:
            i += 1
    return trades, a, p, lr

def net(tr, d, volslip=True):
    N = d * B
    slip_side = N * ((0.25*tr["sb"] if volslip else 0) + 2*N/tr["liq"])
    return N*tr["r"] - N*tr["fee"] - GAS_RT - 2*slip_side

def net_casc(tr, d):
    c = tr["casc"][d]; N = c["notional"]
    slip_side = N * (0.25*tr["sb"] + 2*B/tr["liq"])
    gas = 0.06*c["layers"] + 0.06
    return c["gross_usd"] - N*tr["fee"] - gas - 2*slip_side

def merged_edges(ps):
    edges = list(EDGES)
    while True:
        cnt = np.histogram(ps, bins=edges)[0]
        if len(cnt) <= 2 or cnt.min() >= 20: return edges, cnt
        med = np.median(ps); mb = np.searchsorted(edges, med) - 1
        j = int(np.argmin(cnt))
        # merge toward median bucket
        if j < mb or j == 0: edges.pop(j+1)
        elif j > mb or j == len(cnt)-1: edges.pop(j)
        else: edges.pop(j+1)

def bucket_table(trs, edges, fn):
    ps = np.array([x["p"] for x in trs]); rows = []
    for b in range(len(edges)-1):
        m = (ps >= edges[b]) & (ps < edges[b+1]); idx = np.where(m)[0]
        if len(idx) == 0: rows.append(None); continue
        row = dict(lo=edges[b], hi=edges[b+1] if edges[b+1] != math.inf else None, n=int(len(idx)),
                   p_med=float(np.median(ps[idx])))
        for d in ([1,3,5] if fn is net_casc else TIERS):
            v = np.array([fn(trs[k], d) for k in idx])
            N = d*B
            row[f"d{d}"] = dict(mean_usd=float(v.mean()), loss_rate=float((v < 0).mean()), roc=float(v.mean()/N))
        rows.append(row)
    return rows

def crossings(rows, a=5, b=1):
    pts = [(r["p_med"], r[f"d{a}"]["mean_usd"] - r[f"d{b}"]["mean_usd"]) for r in rows if r]
    out = []
    for (p0, d0), (p1, d1) in zip(pts, pts[1:]):
        if d0 == 0: continue
        if (d0 > 0) != (d1 > 0):
            x = p0 + (p1-p0) * d0/(d0-d1)
            out.append(dict(p=float(x), kind="+to-" if d0 > 0 else "-to+"))
    return out, pts

def bootstrap(trs, edges, fn, ref, reps=1000, seed=887):
    rng = np.random.default_rng(seed)
    days = {}
    for k, x in enumerate(trs): days.setdefault(x["t"]//86400, []).append(k)
    keys = list(days); res = {"+to-": [], "-to+": []}; none = {"+to-": 0, "-to+": 0}
    for _ in range(reps):
        pick = rng.choice(len(keys), len(keys), replace=True)
        s = [trs[k] for j in pick for k in days[keys[j]]]
        cr, _ = crossings(bucket_table(s, edges, fn))
        for kind in res:
            c = [z["p"] for z in cr if z["kind"] == kind]
            if not c: none[kind] += 1; continue
            r0 = ref.get(kind)
            res[kind].append(min(c, key=lambda v: abs(v - r0)) if r0 is not None else c[0])
    out = {}
    for kind, v in res.items():
        if v:
            out[kind] = dict(n=len(v), no_cross=none[kind], median=float(np.median(v)),
                             ci95=[float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))],
                             ci68=[float(np.percentile(v, 16)), float(np.percentile(v, 84))])
        else: out[kind] = dict(n=0, no_cross=none[kind])
    return out

def elasticity(series, tf):
    P = params(tf); X = []
    for sym, (a, p, lr) in series.items():
        c = a[:,4]
        for t in range(P["win"]+1, len(c)-4):
            sb = p[t-1] / P["scale"]  # vol from prior bars
            if not sb > 0: continue
            r = lr[t]
            if 0.5*sb <= abs(r) <= 1.5*sb:
                X.append((p[t-1], r/sb, math.log(c[t+4]/c[t])/sb, sym))
    X = np.array([(x[0], x[1], x[2]) for x in X])
    rows = []
    for b in range(len(EDGES)-1):
        m = (X[:,0] >= EDGES[b]) & (X[:,0] < EDGES[b+1])
        if m.sum() < 30: continue
        x, y = X[m,1], X[m,2]
        beta = np.cov(x, y, bias=True)[0,1]/np.var(x)
        resid = y - (y.mean() + beta*(x - x.mean()))
        se = math.sqrt((resid**2).sum()/(len(x)-2)/((x-x.mean())**2).sum())
        rows.append(dict(lo=EDGES[b], hi=EDGES[b+1] if EDGES[b+1] != math.inf else None, n=int(m.sum()),
                         p_med=float(np.median(X[m,0])), beta_norm=float(beta), se=float(se)))
    return rows

def run(tf, tokens, volslip=True, boot=True):
    pools = json.load(open("data/pools.json"))
    trs = []; series = {}; cov = {}
    for s in tokens:
        f, srcname = src_path(s, tf)
        if not f: continue
        tr, a, p, lr = simulate(s, tf, pools[s]["liqUsd"])
        days = (a[-1,0]-a[0,0])/86400
        cov[s] = dict(bars=int(len(a)), raw_bars=len(json.load(open(f))), source=srcname, days=round(days,1),
                      first=int(a[0,0]), last=int(a[-1,0]), trades=len(tr), pool=pools[s]["pool"], pool_name=pools[s]["name"],
                      p_median=float(np.nanmedian(p)), p_p10=float(np.nanpercentile(p,10)), p_p90=float(np.nanpercentile(p,90)))
        series[s] = (a, p, lr)
        if days >= 14: trs += tr
    fn = net if volslip else (lambda tr, d: net(tr, d, False))
    fn.__name__ = "net"
    ps = np.array([x["p"] for x in trs]); edges, cnt = merged_edges(ps)
    tab = bucket_table(trs, edges, net if volslip else fn) if volslip else bucket_table(trs, edges, fn)
    cr, pts = crossings(tab)
    extra = {f"d{a}v{b}": crossings(tab, a, b)[0] for a, b in [(3,1),(5,3),(10,5),(25,10),(25,1)]}
    ref = {k: next((z["p"] for z in cr if z["kind"]==k), None) for k in ["+to-","-to+"]}
    bs = bootstrap(trs, edges, net if volslip else fn, ref) if boot else None
    per_tok = {}
    for s in cov:
        st = [x for x in trs if x["sym"] == s]
        if len(st) < 10: per_tok[s] = dict(n=len(st)); continue
        r = np.array([x["r"] for x in st])
        n1 = np.array([net(x,1) for x in st]); n5 = np.array([net(x,5) for x in st])
        e2, _ = merged_edges(np.array([x["p"] for x in st]))
        tt = bucket_table(st, e2, net); c2, _ = crossings(tt)
        per_tok[s] = dict(n=len(st), tp_rate=float(np.mean([x["tp_hit"] for x in st])), mean_gross=float(r.mean()),
                          mean_net_d1=float(n1.mean()), mean_net_d5=float(n5.mean()), p_med=float(np.median([x["p"] for x in st])),
                          crossings=c2, buckets=[(z["p_med"], z["n"], z["d5"]["mean_usd"]-z["d1"]["mean_usd"]) for z in tt if z])
    casc = None
    if volslip:
        ct = bucket_table(trs, edges, net_casc)
        casc = dict(table=ct, crossings=crossings(ct)[0])
    return dict(tf=tf, volslip=volslip, coverage=cov, n_trades=len(trs), edges=[e if e != math.inf else None for e in edges],
                table=tab, delta_pts=pts, crossings=cr, tier_crossings=extra, bootstrap=bs, per_token=per_tok,
                cascade=casc, elasticity=elasticity(series, tf) if volslip else None,
                overall=dict(tp_rate=float(np.mean([x["tp_hit"] for x in trs])), mean_gross=float(np.mean([x["r"] for x in trs]))))

if __name__ == "__main__":
    os.makedirs("results", exist_ok=True)
    res = {"primary_15m": run("15m", TOKENS)}
    res["sens_15m_no_volslip"] = run("15m", TOKENS, volslip=False)
    res["robust_1h"] = run("1h", TOKENS)
    json.dump(res, open("results/pstar_results.json", "w"), indent=1, default=str)
    for k, v in res.items():
        print("==", k, "trades", v["n_trades"], "crossings", v["crossings"], "boot", v["bootstrap"])
