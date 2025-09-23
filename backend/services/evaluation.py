
def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))

def _to_0_10_from_interval(x: float | None, best: float, worst: float, invert: bool = False) -> float:
    if x is None: return 5.0
    a, b = (best, worst) if not invert else (worst, best)
    if a == b: return 5.0
    t = (x - a) / (b - a)
    t = 1.0 - t if invert else t
    return 10.0 * _clamp01(t)

def evaluate_athlete(d: dict) -> dict:
    speed = _to_0_10_from_interval(d.get("velocidade_sprint"), best=2.8, worst=4.5, invert=True)
    agility = _to_0_10_from_interval(d.get("agilidade"), best=9.0, worst=12.5, invert=True)
    jump = _to_0_10_from_interval(d.get("salto_vertical"), best=75.0, worst=30.0)
    endurance = 5.0
    
    def S(key): return float(d.get(key, 5.0))
    
    try:
        bmi = d["peso"] / ((d["altura"] / 100.0) ** 2)
    except (TypeError, ZeroDivisionError):
        bmi = None

    skill_keys = [
        "controle_bola", "drible", "passe_curto", "passe_longo", "finalizacao", 
        "cabeceio", "desarme", "visao_jogo", "compostura", "agressividade"
    ]
    
    feats = { key: S(key) for key in skill_keys }
    feats['velocidade'] = speed
    feats['agilidade'] = agility
    feats['salto'] = jump
    feats['resistencia'] = endurance

    positions = {
        "goleiro": {"compostura": 0.30, "salto": 0.25, "visao_jogo": 0.20, "passe_curto": 0.15, "passe_longo": 0.10},
        "zagueiro": {"desarme": 0.25, "cabeceio": 0.20, "compostura": 0.15, "passe_curto": 0.10, "agressividade": 0.15, "salto": 0.15},
        "lateral": {"velocidade": 0.25, "drible": 0.15, "passe_longo": 0.10, "desarme": 0.15, "resistencia": 0.20, "agilidade": 0.15},
        "volante": {"desarme": 0.20, "passe_curto": 0.20, "compostura": 0.15, "visao_jogo": 0.20, "agressividade": 0.10, "resistencia": 0.15},
        "meia": {"visao_jogo": 0.25, "passe_curto": 0.20, "drible": 0.15, "finalizacao": 0.15, "compostura": 0.15, "passe_longo": 0.10},
        "ponta": {"velocidade": 0.30, "drible": 0.25, "finalizacao": 0.20, "agilidade": 0.15, "passe_curto": 0.10},
        "atacante": {"finalizacao": 0.35, "cabeceio": 0.15, "compostura": 0.15, "visao_jogo": 0.10, "agressividade": 0.15, "controle_bola": 0.10}
    }
    
    pos_scores = {}
    for pos, weights in positions.items():
        score = sum(w * feats.get(feat, 5.0) for feat, w in weights.items())
        total_weight = sum(weights.values())
        pos_scores[pos] = round((score / total_weight) * 10, 1) if total_weight > 0 else 0.0
    
    best_position = max(pos_scores, key=pos_scores.get) if pos_scores else "N/A"

    tech_avg = sum(feats[s] for s in skill_keys) / len(skill_keys)
    phys_avg = sum([speed, agility, jump, endurance]) / 4.0
    potential = round((0.6 * tech_avg + 0.4 * phys_avg) * 10, 1)

    risk = 0.0
    notes = []
    if bmi is not None:
        if bmi > 25:
            risk += (bmi - 25) * 1.5
            if bmi >= 27.5: notes.append("IMC elevado, pode impactar agilidade e resistência.")
    risk += (10.0 - agility) * 0.4 + S("agressividade") * 0.3
    injury_score = round(_clamp01(risk / 10.0) * 100.0, 0)
    label = "baixo"
    if injury_score >= 67: label = "alto"
    elif injury_score >= 34: label = "médio"

    return { "best_position": best_position, "position_scores": pos_scores, "potential_score": potential, "injury_risk_score": int(injury_score), "injury_risk_label": label, "bmi": round(bmi, 1) if bmi else None, "notes": notes }