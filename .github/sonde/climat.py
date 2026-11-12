import json, time, urllib.request, statistics as st
LAT, LON = 43.303347, 5.403146
MODELS = ["EC_Earth3P_HR", "MRI_AGCM3_2_S", "CMCC_CM2_VHR4"]
WIN = {"ref": ("1991", "2020"), "2030": ("2021", "2035"), "2050": ("2036", "2050")}
def get(url):
    for i in range(6):
        try:
            with urllib.request.urlopen(url, timeout=120) as r: return json.load(r)
        except urllib.error.HTTPError as e:
            print("HTTP", e.code, url[:90], flush=True); time.sleep(60 if e.code == 429 else 10)
    raise SystemExit("échec " + url)
def indic(d, y0, y1):
    T, tx, tn, tm = d["time"], d["temperature_2m_max"], d["temperature_2m_min"], d["temperature_2m_mean"]
    idx = [i for i, t in enumerate(T) if y0 <= t[:4] <= y1 and tm[i] is not None and tx[i] is not None and tn[i] is not None]
    yrs = len({T[i][:4] for i in idx})
    o = dict(tmoy=st.mean(tm[i] for i in idx), nt=0, j30=0, j35=0, djuC=0, djuF=0, vag=0, m30=[0]*12, mnt=[0]*12)
    run = 0
    for i in idx:
        m = int(T[i][5:7]) - 1
        if tm[i] < 18: o["djuC"] += 18 - tm[i]
        if tm[i] > 18: o["djuF"] += tm[i] - 18
        if tn[i] >= 20: o["nt"] += 1; o["mnt"][m] += 1
        if tx[i] >= 30:
            o["j30"] += 1; o["m30"][m] += 1; run += 1
            if run == 3: o["vag"] += 1
        else: run = 0
        if tx[i] >= 35: o["j35"] += 1
    for k in ["nt", "j30", "j35", "djuC", "djuF", "vag"]: o[k] /= yrs
    o["m30"] = [v / yrs for v in o["m30"]]; o["mnt"] = [v / yrs for v in o["mnt"]]
    return o
daily = "temperature_2m_max,temperature_2m_min,temperature_2m_mean"
obs = get(f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}&start_date=1991-01-01&end_date=2020-12-31&daily={daily}&timezone=Europe%2FParis")["daily"]
O = indic(obs, "1991", "2020")
time.sleep(20)
stripes = get(f"https://archive-api.open-meteo.com/v1/archive?latitude={LAT}&longitude={LON}&start_date=1950-01-01&end_date=2025-12-31&daily=temperature_2m_mean&timezone=Europe%2FParis")["daily"]
ann = {}
for t, v in zip(stripes["time"], stripes["temperature_2m_mean"]):
    if v is not None: ann.setdefault(t[:4], []).append(v)
ann = {y: round(st.mean(v), 2) for y, v in ann.items() if len(v) > 360}
res = {"obs": O, "annual": ann, "models": {}}
for m in MODELS:
    time.sleep(30)
    d = get(f"https://climate-api.open-meteo.com/v1/climate?latitude={LAT}&longitude={LON}&start_date=1991-01-01&end_date=2050-12-31&models={m}&daily={daily}")["daily"]
    res["models"][m] = {w: indic(d, *yy) for w, yy in WIN.items()}
    print("ok", m, flush=True)
# Méthode des écarts : obs + (futur modèle − référence modèle)
out = {"obs": {k: (round(v, 1) if not isinstance(v, list) else [round(x, 1) for x in v]) for k, v in O.items()}, "annual": ann, "proj": {}}
for w in ["2030", "2050"]:
    per = {}
    for k in ["tmoy", "nt", "j30", "j35", "djuC", "djuF", "vag"]:
        vals = [O[k] + res["models"][m][w][k] - res["models"][m]["ref"][k] for m in MODELS]
        per[k] = {"moy": round(st.mean(vals), 1), "min": round(min(vals), 1), "max": round(max(vals), 1)}
    for k in ["m30", "mnt"]:
        per[k] = [round(max(0, O[k][i] + st.mean(res["models"][m][w][k][i] - res["models"][m]["ref"][k][i] for m in MODELS)), 1) for i in range(12)]
    out["proj"][w] = per
# biais bruts des modèles (référence modèle vs observation), pour information
out["biais"] = {m: {k: round(res["models"][m]["ref"][k] - O[k], 1) for k in ["tmoy", "nt", "j30"]} for m in MODELS}
print("RESULTAT " + json.dumps(out, ensure_ascii=False))
