'use strict';
// =====================================================================
// Machines & corrections
//
// Une correction remplace le compteur relevé par Kpax pour une machine à un
// relevé donné (ou ajoute un relevé absent). Les données Kpax d'origine ne
// sont jamais modifiées : on peut toujours supprimer une correction.
// Exemples d'usage :
//  - aligner un compteur sur celui de la facture SCC après vérification ;
//  - saisir le compteur de départ d'une machine neuve ou déplacée ;
//  - remplacer un relevé à 0 ou aberrant.
// =====================================================================

let serieCourante = '';

function vueMachines(el, params) {
    if (baseVide()) return messageBaseVide(el);
    if (params.serie) serieCourante = normSerie(params.serie);
    const liste = q(`SELECT upper(replace(trim(numero_de_serie),' ','')) AS s, MAX(modele) AS modele, MAX(source) AS source
                     FROM kpax WHERE length(trim(numero_de_serie)) >= 5 GROUP BY 1 ORDER BY 1`);
    el.innerHTML = `
        <h2>Machines &amp; corrections</h2>
        <p class="sous-titre">Historique d'une machine, et correction de ses compteurs quand c'est nécessaire.</p>
        <div class="carte"><div class="row g-2 align-items-end">
            <div class="col-md-5"><label class="form-label small">N° de série</label>
                <input class="form-control" id="m-serie" list="m-liste" value="${esc(serieCourante)}" placeholder="Saisir ou choisir un n° de série">
                <datalist id="m-liste">${liste.map(m => `<option value="${esc(m.s)}">${esc(m.source)} · ${esc(m.modele)}</option>`).join('')}</datalist>
            </div>
            <div class="col-auto"><button class="btn btn-success" onclick="serieCourante=normSerie(document.getElementById('m-serie').value);afficherVue('machines')">Afficher</button></div>
        </div></div>
        <div id="m-detail"></div>
        <div class="carte"><h3>Toutes les corrections saisies</h3><div id="m-corrections"></div></div>`;
    document.getElementById('m-serie').addEventListener('keydown', e => {
        if (e.key === 'Enter') { serieCourante = normSerie(e.target.value); afficherVue('machines'); }
    });
    if (serieCourante) rendreMachine(serieCourante);
    rendreListeCorrections();
}

function historiquesMachine(serie) {
    const { historiques } = construireHistoriques(lireReleves(serie), lireCorrections());
    return [...historiques.values()].filter(h => h.serie === serie);
}

function rendreMachine(serie) {
    const el = document.getElementById('m-detail');
    const hists = historiquesMachine(serie);
    if (!hists.length) { el.innerHTML = alerte('warning', `Aucun relevé pour le n° de série « ${esc(serie)} ».`); return; }
    let h = '';
    if (hists.length > 1) {
        h += alerte('danger', `<i class="fas fa-triangle-exclamation me-1"></i>Cette machine apparaît chez <b>${hists.map(x => esc(x.fournisseur)).join(' et ')}</b>.
            Vérifiez qu'elle n'est pas facturée deux fois (et indiquez le fournisseur concerné dans une éventuelle correction).`);
    }
    hists.forEach((hist, i) => {
        const pts = hist.pts;
        const conso = new Map(q('SELECT * FROM consommation WHERE numero_de_serie=? AND fournisseur=?', [serie, hist.fournisseur]).map(c => [c.periode, c]));
        const der = pts[pts.length - 1];
        // Une ligne par relevé ; la consommation affichée est celle du mois du relevé
        const lignes = pts.slice().reverse().map(p => {
            const c = conso.get(p.date) || null;
            return {
                date: p.date, source: p.source, regle: p.regle, fournisseur: hist.fournisseur,
                kpaxMono: p.kpaxMono, kpaxCouleur: p.kpaxCouleur,
                mono: p.mono, couleur: p.couleur, correction: p.correction,
                volMono: c ? c.volume_pages_mono : null, volCouleur: c ? c.volume_pages_couleur : null,
                statut: c ? c.statut : '', detail: c ? c.detail : '',
            };
        });
        const nouvelle = conso.get(decalerMois(pts[0].date, -1));
        h += `<div class="carte">
        <h3>${esc(serie)} — ${esc(der.constructeur)} ${esc(der.modele)}</h3>
        <p class="small mb-2">Source <b>${esc(der.source)}</b> · fournisseur <b>${esc(der.fournisseur)}</b> · ${esc(typeMachine(der.constructeur))}
            · règle de lecture : <code>${esc(der.regle || '—')}</code></p>
        ${nouvelle ? alerte('warning', `Machine comptée comme <b>nouvelle</b> : ${nf(nouvelle.volume_pages_mono)} pages mono / ${nf(nouvelle.volume_pages_couleur)} couleur
            imputées sur ${esc(libMois(nouvelle.periode))}. Si la machine n'était pas neuve, saisissez une correction sur le relevé de
            ${esc(libMois(pts[0].date))} (même compteur) : il deviendra le point de départ.`) : ''}
        ${tableHTML('t-machine-' + i, [
            { k: 'date', t: 'Relevé', html: l => esc(libMois(l.date)) },
            { k: 'source', t: 'Source' },
            { k: 'kpaxMono', t: 'Kpax mono', type: 'n' }, { k: 'kpaxCouleur', t: 'Kpax couleur', type: 'n' },
            { k: 'mono', t: 'Retenu mono', type: 'n', cls: l => l.correction ? 'fw-bold text-primary' : '' },
            { k: 'couleur', t: 'Retenu couleur', type: 'n', cls: l => l.correction ? 'fw-bold text-primary' : '' },
            { k: 'volMono', t: 'Conso mono du mois', type: 'n', aide: 'Consommation du mois de ce relevé (= relevé suivant − ce relevé)' },
            { k: 'volCouleur', t: 'Conso couleur du mois', type: 'n' },
            { k: 'statut', t: 'Statut', html: l => l.statut ? `<span class="badge text-bg-${STATUTS_A_VERIFIER.includes(l.statut) ? 'warning' : 'light'}" title="${esc(l.detail)}">${esc(l.statut)}</span>` : '' },
            { k: 'correction', t: 'Correction', export: false, html: l => l.correction
                ? `<span title="${esc(l.correction.commentaire)}"><i class="fas fa-pen text-primary"></i> ${esc(l.correction.commentaire || '')}</span>
                   <button class="btn btn-sm btn-link" onclick="preparerCorrection('${l.date}','${esc(l.fournisseur)}')">modifier</button>`
                : `<button class="btn btn-sm btn-link" onclick="preparerCorrection('${l.date}','${esc(l.fournisseur)}')">corriger</button>` },
        ], lignes, { nomFichier: `machine_${serie}_${hist.fournisseur}` })}
        <p class="aide mt-2 mb-0">Conso du mois = compteur du relevé suivant − compteur de ce relevé. En gras bleu : compteur corrigé.</p>
        </div>`;
    });
    const fours = hists.map(x => [x.fournisseur, x.fournisseur]);
    h += `<div class="carte" id="m-form">
            <h3>Ajouter / modifier une correction</h3>
            <div class="row g-2 align-items-end">
                <div class="col-auto"><label class="form-label small">Relevé (AAAA-MM)</label><input class="form-control form-control-sm" id="cor-date" style="width:8rem" placeholder="AAAA-MM"></div>
                ${hists.length > 1 ? `<div class="col-auto"><label class="form-label small">Fournisseur</label><select class="form-select form-select-sm" id="cor-four">${optionsHTML(fours, '', 'Tous')}</select></div>` : ''}
                <div class="col-auto"><label class="form-label small">Compteur mono</label><input class="form-control form-control-sm" id="cor-mono" inputmode="numeric" placeholder="inchangé"></div>
                <div class="col-auto"><label class="form-label small">Compteur couleur</label><input class="form-control form-control-sm" id="cor-coul" inputmode="numeric" placeholder="inchangé"></div>
                <div class="col"><label class="form-label small">Motif (obligatoire)</label><input class="form-control form-control-sm" id="cor-com" placeholder="ex. : index facture SCC T1 2026"></div>
                <div class="col-auto"><button class="btn btn-sm btn-primary" onclick="enregistrerCorrection('${esc(serie)}')">Enregistrer</button></div>
            </div>
            <p class="aide mt-2 mb-0">Saisissez le <b>compteur cumulé</b> (pas un volume). Laisser vide = conserver la valeur Kpax.
            Un relevé absent de Kpax peut être ajouté en saisissant un mois sans relevé.</p>
        </div>`;
    el.innerHTML = h;
}

function preparerCorrection(date, fournisseur) {
    const hist = historiquesMachine(serieCourante).find(x => x.fournisseur === fournisseur);
    const p = hist ? hist.pts.find(x => x.date === date) : null;
    document.getElementById('cor-date').value = date;
    const four = document.getElementById('cor-four');
    if (four) four.value = p && p.correction ? (p.correction.fournisseur || '') : fournisseur;
    document.getElementById('cor-mono').value = p && p.correction && p.correction.compteur_mono !== null ? p.correction.compteur_mono : (p && p.kpaxMono) ?? '';
    document.getElementById('cor-coul').value = p && p.correction && p.correction.compteur_couleur !== null ? p.correction.compteur_couleur : (p && p.kpaxCouleur) ?? '';
    document.getElementById('cor-com').value = p && p.correction ? p.correction.commentaire || '' : '';
    document.getElementById('m-form').scrollIntoView({ behavior: 'smooth' });
    document.getElementById('cor-mono').focus();
}

async function enregistrerCorrection(serie) {
    const date = document.getElementById('cor-date').value.trim();
    const four = document.getElementById('cor-four') ? document.getElementById('cor-four').value || null : null;
    const mono = num(document.getElementById('cor-mono').value);
    const coul = num(document.getElementById('cor-coul').value);
    const com = document.getElementById('cor-com').value.trim();
    if (!estPeriode(date)) return toast('Mois du relevé invalide (format AAAA-MM).', 'erreur');
    if (mono === null && coul === null) return toast('Saisir au moins un compteur.', 'erreur');
    if (!com) return toast('Indiquez le motif de la correction (traçabilité).', 'erreur');
    run(`INSERT INTO corrections (numero_de_serie, date_compteurs, compteur_mono, compteur_couleur, commentaire, cree_le, fournisseur)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(numero_de_serie, date_compteurs) DO UPDATE SET
           compteur_mono=excluded.compteur_mono, compteur_couleur=excluded.compteur_couleur,
           commentaire=excluded.commentaire, cree_le=excluded.cree_le, fournisseur=excluded.fournisseur`,
        [serie, date, mono, coul, com, new Date().toISOString().slice(0, 16).replace('T', ' '), four]);
    recalculerConsommation();
    await sauvegarder();
    toast('Correction enregistrée, consommation recalculée.');
    afficherVue('machines');
}

async function supprimerCorrection(id) {
    if (!confirm('Supprimer cette correction ? Le compteur Kpax d\'origine sera de nouveau utilisé.')) return;
    run('DELETE FROM corrections WHERE id=?', [id]);
    recalculerConsommation();
    await sauvegarder();
    toast('Correction supprimée.');
    afficherVue('machines');
}

function rendreListeCorrections() {
    const lignes = q('SELECT * FROM corrections ORDER BY cree_le DESC');
    document.getElementById('m-corrections').innerHTML = tableHTML('t-corrections', [
        { k: 'numero_de_serie', t: 'N° de série', html: l => `<a class="lien" onclick="afficherVue('machines',{serie:'${esc(l.numero_de_serie)}'})">${esc(l.numero_de_serie)}</a>` },
        { k: 'date_compteurs', t: 'Relevé', html: l => esc(libMois(l.date_compteurs)) },
        { k: 'fournisseur', t: 'Fournisseur', html: l => esc(l.fournisseur || 'tous') },
        { k: 'compteur_mono', t: 'Compteur mono', type: 'n' }, { k: 'compteur_couleur', t: 'Compteur couleur', type: 'n' },
        { k: 'commentaire', t: 'Motif' }, { k: 'cree_le', t: 'Saisie le' },
        { k: 'id', t: '', export: false, html: l => `<button class="btn btn-sm btn-link text-danger" onclick="supprimerCorrection(${l.id})"><i class="fas fa-trash"></i></button>` },
    ], lignes, { vide: 'Aucune correction pour le moment.', nomFichier: 'corrections' });
}
