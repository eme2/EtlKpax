'use strict';
// =====================================================================
// BUDGET ANNUEL : consommation réelle vs estimation (pages et euros)
// =====================================================================

let anneeBudget = null;
let graphes = [];

function objectifsAnnee(an) {
    return new Map(q('SELECT * FROM objectifs WHERE annee=?', [an]).map(o => [o.source, o]));
}

// Synthèse par source : réalisé, projection linéaire sur 12 mois, objectif
function syntheseBudget(an) {
    const obj = objectifsAnnee(an);
    const reel = q(`SELECT source, COUNT(DISTINCT periode) AS nb_mois, SUM(volume_pages_mono) AS mono, SUM(volume_pages_couleur) AS couleur
                    FROM consommation WHERE annee=? GROUP BY source ORDER BY source`, [an]);
    const sources = [...new Set([...reel.map(r => r.source), ...obj.keys()])].sort();
    const lignes = sources.map(source => {
        const r = reel.find(x => x.source === source) || { nb_mois: 0, mono: 0, couleur: 0 };
        const o = obj.get(source) || {};
        const projMono = r.nb_mois ? r.mono / r.nb_mois * 12 : 0;
        const projCouleur = r.nb_mois ? r.couleur / r.nb_mois * 12 : 0;
        const pm = o.prix_mono || 0, pc = o.prix_couleur || 0;
        return {
            source, nbMois: r.nb_mois, mono: r.mono || 0, couleur: r.couleur || 0, projMono, projCouleur,
            objMono: o.pages_mono || 0, objCouleur: o.pages_couleur || 0, prixMono: pm, prixCouleur: pc,
            ratioMono: o.pages_mono ? projMono / o.pages_mono : null,
            ratioCouleur: o.pages_couleur ? projCouleur / o.pages_couleur : null,
            montantReel: (r.mono || 0) * pm + (r.couleur || 0) * pc,
            montantProj: projMono * pm + projCouleur * pc,
            montantBudget: (o.pages_mono || 0) * pm + (o.pages_couleur || 0) * pc,
        };
    }).filter(l => l.nbMois || l.objMono || l.objCouleur);
    return { lignes };
}

function vueBudget(el) {
    if (baseVide()) return messageBaseVide(el);
    const annees = [...new Set([...q('SELECT DISTINCT annee FROM consommation').map(r => r.annee), ...q('SELECT DISTINCT annee FROM objectifs').map(r => r.annee)])].sort().reverse();
    if (!anneeBudget || !annees.includes(anneeBudget)) anneeBudget = annees[0];
    const an = anneeBudget;
    const { lignes } = syntheseBudget(an);
    const obj = objectifsAnnee(an);
    const sources = [...new Set([...q('SELECT DISTINCT source FROM kpax WHERE source IS NOT NULL').map(r => r.source), ...obj.keys()])].sort();
    const champ = (s, k, pas) => `<input type="number" step="${pas}" min="0" class="form-control form-control-sm text-end" data-source="${esc(s)}" data-champ="${k}" value="${obj.get(s) && obj.get(s)[k] !== null ? obj.get(s)[k] : ''}">`;

    el.innerHTML = `
        <h2>Budget annuel</h2>
        <p class="sous-titre">Consommation réelle comparée à votre estimation annuelle, en pages et en montant moyen.</p>
        <div class="carte"><div class="row g-2 align-items-end">
            <div class="col-auto"><label class="form-label small">Année</label>
            <select class="form-select form-select-sm" onchange="anneeBudget=Number(this.value);afficherVue('budget')">${optionsHTML([...new Set([...annees, new Date().getFullYear()])].sort().reverse(), an)}</select></div>
        </div></div>
        <div class="kpis">${lignes.map(l => `
            <div class="kpi"><div class="libelle">${esc(l.source)} · ${l.nbMois} mois connus</div>
                <div class="detail">Mono : <b>${nf(l.mono)}</b> pages → projection <b>${nf(l.projMono)}</b>
                    ${l.objMono ? ` / objectif ${nf(l.objMono)} <span class="${l.ratioMono > 1 ? 'text-danger' : 'text-success'}">(${pct(l.ratioMono)})</span>` : ''}</div>
                <div class="detail">Couleur : <b>${nf(l.couleur)}</b> pages → projection <b>${nf(l.projCouleur)}</b>
                    ${l.objCouleur ? ` / objectif ${nf(l.objCouleur)} <span class="${l.ratioCouleur > 1 ? 'text-danger' : 'text-success'}">(${pct(l.ratioCouleur)})</span>` : ''}</div>
                ${l.prixMono || l.prixCouleur ? `<div class="detail mt-1">Montant : <b>${eur(l.montantReel)}</b> à date · projeté <b>${eur(l.montantProj)}</b> · budget ${eur(l.montantBudget)}</div>`
                    : '<div class="aide mt-1">Saisir les prix moyens pour obtenir les montants.</div>'}
            </div>`).join('')}</div>
        <div class="graphes" id="graphes-budget"></div>
        <div class="carte mt-3"><h3>Objectifs ${an}</h3>
            <div class="tableau-wrap"><table class="table table-sm align-middle" style="max-width:780px"><thead><tr>
                <th>Source</th><th class="n">Pages mono / an</th><th class="n">Pages couleur / an</th><th class="n">Prix moyen mono (€/page)</th><th class="n">Prix moyen couleur (€/page)</th>
            </tr></thead><tbody>
            ${sources.map(s => `<tr><td>${esc(s)}</td><td>${champ(s, 'pages_mono', 1)}</td><td>${champ(s, 'pages_couleur', 1)}</td>
                <td>${champ(s, 'prix_mono', 0.0001)}</td><td>${champ(s, 'prix_couleur', 0.0001)}</td></tr>`).join('')}
            </tbody></table></div>
            <button class="btn btn-sm btn-success mt-2" onclick="enregistrerObjectifs(${an})">Enregistrer les objectifs</button>
            ${!obj.size ? `<button class="btn btn-sm btn-outline-secondary mt-2 ms-2" onclick="copierObjectifs(${an})">Reprendre ceux de ${an - 1}</button>` : ''}
            <p class="aide mt-2 mb-0">Prix moyen par page en € HT (ex. 0,0045). Projection = moyenne des mois connus × 12.</p>
        </div>`;
    dessinerGraphes(an, lignes);
}

async function enregistrerObjectifs(an) {
    const vals = {};
    document.querySelectorAll('input[data-champ]').forEach(i => {
        (vals[i.dataset.source] = vals[i.dataset.source] || {})[i.dataset.champ] = num(i.value);
    });
    transaction(() => {
        for (const [s, v] of Object.entries(vals)) {
            if (Object.values(v).every(x => x === null)) { run('DELETE FROM objectifs WHERE annee=? AND source=?', [an, s]); continue; }
            run('INSERT OR REPLACE INTO objectifs VALUES (?,?,?,?,?,?)', [an, s, v.pages_mono, v.pages_couleur, v.prix_mono, v.prix_couleur]);
        }
    });
    await sauvegarder();
    toast('Objectifs enregistrés.');
    afficherVue('budget');
}

async function copierObjectifs(an) {
    run('INSERT OR IGNORE INTO objectifs SELECT ?, source, pages_mono, pages_couleur, prix_mono, prix_couleur FROM objectifs WHERE annee=?', [an, an - 1]);
    await sauvegarder();
    afficherVue('budget');
}

function dessinerGraphes(an, synthese) {
    graphes.forEach(g => g.destroy());
    graphes = [];
    const cont = document.getElementById('graphes-budget');
    if (typeof Chart === 'undefined') { cont.innerHTML = alerte('warning', 'Bibliothèque de graphiques indisponible (connexion Internet ?).'); return; }
    const mois = listePeriodes(`${an}-01`, `${an}-12`);
    const etiquettes = mois.map(libMois);
    for (const l of synthese) {
        const data = new Map(q('SELECT periode, SUM(volume_pages_mono) AS m, SUM(volume_pages_couleur) AS c FROM consommation WHERE annee=? AND source=? GROUP BY periode', [an, l.source]).map(r => [r.periode, r]));
        const mono = mois.map(p => data.has(p) ? data.get(p).m : null);
        const coul = mois.map(p => data.has(p) ? data.get(p).c : null);
        const cumul = arr => { let s = 0; const dernier = arr.reduce((d, v, i) => v !== null ? i : d, -1); return arr.map((v, i) => i <= dernier ? (s += v || 0) : null); };

        for (const [type, valeurs, objectif, couleurTrait] of [['mono', mono, l.objMono, '#6c757d'], ['couleur', coul, l.objCouleur, '#1aa3a3']]) {
            if (type === 'couleur' && !l.couleur && !objectif) continue;
            const div = document.createElement('div');
            div.className = 'graphe';
            const canvas = document.createElement('canvas');
            div.appendChild(canvas);
            cont.appendChild(div);
            const jeux = [
                { type: 'bar', label: 'Pages du mois', data: valeurs, backgroundColor: couleurTrait + '99', yAxisID: 'y' },
                { type: 'line', label: 'Cumul réel', data: cumul(valeurs), borderColor: couleurTrait, backgroundColor: couleurTrait, tension: .1, yAxisID: 'y1' },
            ];
            if (objectif) jeux.push({ type: 'line', label: 'Objectif cumulé', data: mois.map((_, i) => Math.round(objectif / 12 * (i + 1))),
                borderColor: '#d9534f', borderDash: [6, 4], pointRadius: 0, yAxisID: 'y1' });
            graphes.push(new Chart(canvas, {
                data: { labels: etiquettes, datasets: jeux },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { title: { display: true, text: `${l.source} – pages ${type} ${an}` } },
                    scales: {
                        y: { beginAtZero: true, position: 'left', title: { display: true, text: 'par mois' } },
                        y1: { beginAtZero: true, position: 'right', title: { display: true, text: 'cumul' }, grid: { drawOnChartArea: false } },
                    },
                },
            }));
        }
    }
}
