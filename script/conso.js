'use strict';
// =====================================================================
// CALCUL DE LA CONSOMMATION MENSUELLE
//
// Principe : un relevé Kpax du mois M (fichier de début de mois) donne les
// compteurs au 1er du mois. La consommation du mois M = compteur(M+1) - compteur(M).
//
// La table consommation est ENTIÈREMENT recalculée (kpax + corrections) après
// chaque import ou correction : il n'y a plus de choix "tout / manquants".
//
// Règles :
//  - 1er relevé d'une machine dans le tout premier import de son lot
//    (fournisseur + source) : sert de point de départ, aucune consommation.
//  - 1er relevé d'une machine apparue plus tard : statut "Nouvelle", tout le
//    compteur est compté sur le mois précédent (machine neuve supposée à 0).
//    Si ce n'est pas le cas, saisir une correction (compteur de départ).
//  - Compteur vide ou à 0 : "Relevé manquant", on reporte la dernière valeur
//    valide ; la consommation sera rattrapée au relevé valide suivant.
//  - Compteur en baisse : anomalie, volume 0, le compteur repart de la
//    nouvelle valeur (remplacement de carte, erreur de relevé…).
//  - Changement de source (ECOLE <-> EMS) : signalé "Déplacée", le
//    compteur continue.
// =====================================================================

const STATUTS_A_VERIFIER = ['Nouvelle', 'Déplacée', 'Rattrapage', 'Relevé manquant', 'Compteur en baisse'];

const COLONNES_COMPTEURS = ['source', 'fournisseur', 'dateCompteurs', 'constructeur', 'modele', 'numero_de_serie',
    'derniere_mise_a_jour', 'compteur_machine', 'total_mono', 'total_couleur', 'mono_a4', 'couleur_a4',
    'mono_recto_a4', 'mono_r_v_a4', 'mono_recto_a3', 'mono_r_v_a3',
    'couleur_recto_a4', 'couleur_r_v_a4', 'couleur_recto_a3', 'couleur_r_v_a3'];

// Relevés kpax (toutes colonnes utiles, absentes = NULL)
function lireReleves(serie) {
    const cols = new Set(colonnesDe('kpax'));
    if (!cols.has('numero_de_serie')) return [];
    const sel = COLONNES_COMPTEURS.map(c => cols.has(c) ? `"${c}"` : `NULL AS "${c}"`).join(', ');
    let sql = `SELECT ${sel} FROM kpax
               WHERE numero_de_serie IS NOT NULL AND length(trim(numero_de_serie)) >= 5 AND dateCompteurs IS NOT NULL`;
    const params = [];
    if (serie) { sql += ` AND upper(replace(trim(numero_de_serie),' ','')) = ?`; params.push(serie); }
    return q(sql + ' ORDER BY dateCompteurs, rowid', params);
}

function lireCorrections() {
    const m = new Map();
    for (const c of q('SELECT * FROM corrections')) {
        const s = normSerie(c.numero_de_serie);
        if (!m.has(s)) m.set(s, new Map());
        m.get(s).set(c.date_compteurs, c);
    }
    return m;
}

// Construit, pour chaque machine, la suite chronologique de ses relevés
// (un par mois, corrections appliquées).
// Une machine est identifiée par fournisseur + n° de série : une même machine
// peut apparaître chez SCC et chez EMC (transfert, double gestion...) et chaque
// fournisseur facture séparément.
function cleMachine(fournisseur, serie) { return `${fournisseur}|${serie}`; }

function construireHistoriques(releves, corrections) {
    const machines = new Map(); // "fournisseur|serie" -> Map(date -> releve)
    const premiers = new Map(); // "fournisseur|source" -> 1er mois importé
    for (const r of releves) {
        const cle = cleMachine(r.fournisseur, normSerie(r.numero_de_serie));
        if (!machines.has(cle)) machines.set(cle, new Map());
        machines.get(cle).set(r.dateCompteurs, r); // en cas de doublon : le dernier gagne
        const lot = `${r.fournisseur}|${r.source}`;
        if (!premiers.has(lot) || r.dateCompteurs < premiers.get(lot)) premiers.set(lot, r.dateCompteurs);
    }

    const historiques = new Map();
    for (const [cle, parDate] of machines) {
        const [fournisseur, serie] = [cle.slice(0, cle.indexOf('|')), cle.slice(cle.indexOf('|') + 1)];
        // Correction sans fournisseur précisé : s'applique à tous
        const corrs = new Map([...(corrections.get(serie) || new Map())]
            .filter(([, c]) => !c.fournisseur || c.fournisseur === fournisseur));
        const dates = [...new Set([...parDate.keys(), ...corrs.keys()])].sort();
        let info = null;
        const pts = [];
        for (const d of dates) {
            const r = parDate.get(d);
            if (r) info = r;
            const base = info || parDate.values().next().value;
            const c = r ? compteursReleve(r) : { mono: null, couleur: null, regle: '' };
            const pt = {
                date: d, releve: r || null,
                source: base.source, fournisseur: base.fournisseur, constructeur: base.constructeur, modele: base.modele,
                kpaxMono: c.mono, kpaxCouleur: c.couleur, regle: c.regle,
                mono: c.mono, couleur: c.couleur,
                correction: corrs.get(d) || null,
                dateReleve: r ? r.derniere_mise_a_jour : null,
            };
            if (pt.correction) {
                if (pt.correction.compteur_mono !== null) pt.mono = pt.correction.compteur_mono;
                if (pt.correction.compteur_couleur !== null) pt.couleur = pt.correction.compteur_couleur;
            }
            pts.push(pt);
        }
        historiques.set(cle, { serie, fournisseur, pts });
    }
    return { historiques, premiers };
}

// Calcule les lignes de consommation d'une machine
function consommationMachine(serie, pts, premiers) {
    const lignes = [];
    let dernierMono = null, dernierCouleur = null, dateDernierValide = null;
    let prec = null;

    const ligne = (periode, pt, v) => {
        const [a, m] = periode.split('-').map(Number);
        lignes.push({
            periode, annee: a, mois: m,
            source: pt.source, fournisseur: pt.fournisseur, numero_de_serie: serie,
            constructeur: pt.constructeur, modele: pt.modele, type_machine: typeMachine(pt.constructeur),
            ...v,
        });
    };

    for (const pt of pts) {
        const monoOk = estValide(pt.mono);
        const coulOk = estValide(pt.couleur);

        if (!prec) {
            const premierLot = premiers.get(`${pt.fournisseur}|${pt.source}`);
            if (pt.correction || pt.date <= premierLot || !monoOk) {
                // Point de départ : pas de consommation
            } else {
                ligne(decalerMois(pt.date, -1), pt, {
                    compteur_mono_debut: 0, compteur_mono_fin: pt.mono, volume_pages_mono: pt.mono,
                    compteur_couleur_debut: 0, compteur_couleur_fin: coulOk ? pt.couleur : 0, volume_pages_couleur: coulOk ? pt.couleur : 0,
                    statut: 'Nouvelle', detail: 'Première apparition : tout le compteur est compté (machine supposée neuve).',
                    corrige: 0, date_releve: pt.dateReleve,
                });
            }
            dernierMono = monoOk ? pt.mono : null;
            dernierCouleur = coulOk ? pt.couleur : null;
            dateDernierValide = monoOk ? pt.date : null;
            prec = pt;
            continue;
        }

        const details = [];
        let statut = null;

        // --- Mono
        const debutMono = dernierMono;
        let volMono = 0;
        if (!monoOk) {
            statut = 'Relevé manquant';
            details.push(`compteur mono absent au relevé de ${libMois(pt.date)}`);
        } else if (dernierMono === null) {
            details.push('premier compteur mono valide : point de départ');
            dernierMono = pt.mono;
            dateDernierValide = pt.date;
        } else if (pt.mono < dernierMono) {
            statut = 'Compteur en baisse';
            details.push(`mono : ${nf(dernierMono)} → ${nf(pt.mono)}`);
            dernierMono = pt.mono;
            dateDernierValide = pt.date;
        } else {
            volMono = pt.mono - dernierMono;
            if (dateDernierValide && dateDernierValide !== prec.date) {
                statut = statut || 'Rattrapage';
                details.push(`inclut la consommation depuis le relevé de ${libMois(dateDernierValide)}`);
            }
            dernierMono = pt.mono;
            dateDernierValide = pt.date;
        }

        // --- Couleur (un compteur couleur à 0 est normal pour une machine mono)
        const debutCouleur = dernierCouleur;
        let volCouleur = 0;
        if (coulOk) {
            if (dernierCouleur === null) {
                dernierCouleur = pt.couleur;
            } else if (pt.couleur < dernierCouleur) {
                statut = 'Compteur en baisse';
                details.push(`couleur : ${nf(dernierCouleur)} → ${nf(pt.couleur)}`);
                dernierCouleur = pt.couleur;
            } else {
                volCouleur = pt.couleur - dernierCouleur;
                dernierCouleur = pt.couleur;
            }
        }

        const ecart = ecartMois(prec.date, pt.date);
        if (ecart > 1) {
            statut = statut || 'Rattrapage';
            details.push(`${ecart} mois entre les relevés de ${libMois(prec.date)} et ${libMois(pt.date)}`);
        }
        if (pt.source !== prec.source) {
            statut = statut || 'Déplacée';
            details.push(`changement de source ${prec.source} → ${pt.source}`);
        }
        if (!statut) statut = volMono > 0 || volCouleur > 0 ? 'Active' : 'Éteinte';

        ligne(prec.date, prec, {
            compteur_mono_debut: debutMono, compteur_mono_fin: monoOk ? pt.mono : debutMono, volume_pages_mono: volMono,
            compteur_couleur_debut: debutCouleur, compteur_couleur_fin: coulOk ? pt.couleur : debutCouleur, volume_pages_couleur: volCouleur,
            statut, detail: details.join(' ; '),
            corrige: (pt.correction || prec.correction) ? 1 : 0,
            date_releve: pt.dateReleve,
        });
        prec = pt;
    }
    return lignes;
}

function recalculerConsommation() {
    if (!db) return { lignes: 0, aVerifier: 0 };
    const { historiques, premiers } = construireHistoriques(lireReleves(), lireCorrections());
    let n = 0, aVerifier = 0;
    transaction(() => {
        run('DELETE FROM consommation');
        const st = db.prepare(`INSERT OR REPLACE INTO consommation
            (periode, annee, mois, source, fournisseur, numero_de_serie, constructeur, modele, type_machine,
             compteur_mono_debut, compteur_mono_fin, volume_pages_mono,
             compteur_couleur_debut, compteur_couleur_fin, volume_pages_couleur,
             statut, detail, corrige, date_releve)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        try {
            for (const { serie, pts } of historiques.values()) {
                for (const l of consommationMachine(serie, pts, premiers)) {
                    st.run([l.periode, l.annee, l.mois, l.source, l.fournisseur, l.numero_de_serie, l.constructeur, l.modele, l.type_machine,
                        l.compteur_mono_debut, l.compteur_mono_fin, l.volume_pages_mono,
                        l.compteur_couleur_debut, l.compteur_couleur_fin, l.volume_pages_couleur,
                        l.statut, l.detail, l.corrige, l.date_releve]);
                    n++;
                    if (STATUTS_A_VERIFIER.includes(l.statut)) aVerifier++;
                }
            }
        } finally {
            st.free();
        }
    });
    majBadgeControles();
    return { lignes: n, aVerifier };
}

function majBadgeControles() {
    const el = document.getElementById('badge-controles');
    if (!el) return;
    if (!db) { el.textContent = ''; return; }
    // Seuls les 3 derniers mois calculés sont comptés dans le badge
    const max = q1('SELECT MAX(periode) AS p FROM consommation').p;
    if (!max) { el.textContent = ''; return; }
    const r = q1(`SELECT COUNT(*) AS n FROM consommation WHERE periode >= ? AND statut IN (${STATUTS_A_VERIFIER.map(() => '?').join(',')})`,
        [decalerMois(max, -2), ...STATUTS_A_VERIFIER]);
    el.textContent = r && r.n ? r.n : '';
}
