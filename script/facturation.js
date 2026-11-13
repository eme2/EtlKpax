'use strict';
// =====================================================================
// VÉRIFICATION DE LA FACTURATION
//
// 1. On choisit le fournisseur et la période (trimestre en général pour SCC).
// 2. L'application affiche la consommation calculée, machine par machine,
//    avec les compteurs de début et de fin.
// 3. On importe la facture (CSV ou Excel) en indiquant quelles colonnes
//    contiennent le n° de série, les volumes (et éventuellement les index).
//    Le choix des colonnes est mémorisé par fournisseur.
// 4. Comparaison machine par machine, écarts mis en évidence.
// =====================================================================

let factu = null;        // { fournisseur, debut, fin }
let factureLue = null;   // { nom, lignes: [[...]], ligneEntete }

// Reconnaissance automatique des colonnes (titres normalisés : minuscules, sans accents).
// Format SCC : "S/N", "Conso A4 N&B", "Conso A3 N&B", "Relevé A4 MONO", "TOTAL COUT PAGE"...
// Les pages A3 sont additionnées en "équivalent A4" (A3 = 2 pages), comme pour le coût SCC.
const estCout = h => /co[uû]t|cout|prix|montant|tarif|€/.test(h);
const estIndex = h => /relev|index|compteur/.test(h);
const estVolume = h => !estCout(h) && !estIndex(h) && /conso|vol|page|qt|quantit|nombre|copies|impression/.test(h);
const estMono = h => /mono|n&b|noir|\bnb\b|black/.test(h);
const estCouleur = h => /coul|color/.test(h);
const estA3 = h => /\ba3\b/.test(h);
const CHAMPS_FACTURE = [
    { k: 'serie', lib: 'N° de série', obligatoire: true, test: h => /^s\/?n\b|s[e]rie|serial|^ns$/.test(h) },
    { k: 'mono', lib: 'Volume mono (A4)', test: h => estVolume(h) && estMono(h) && !estA3(h) },
    { k: 'mono_a3', lib: 'Volume mono A3 (×2)', test: h => estVolume(h) && estMono(h) && estA3(h) },
    { k: 'couleur', lib: 'Volume couleur (A4)', test: h => estVolume(h) && estCouleur(h) && !estA3(h) },
    { k: 'couleur_a3', lib: 'Volume couleur A3 (×2)', test: h => estVolume(h) && estCouleur(h) && estA3(h) },
    { k: 'index_mono', lib: 'Index fin mono (A4)', test: h => estIndex(h) && !estCout(h) && estMono(h) && !estA3(h) },
    { k: 'index_mono_a3', lib: 'Index fin mono A3 (×2)', test: h => estIndex(h) && !estCout(h) && estMono(h) && estA3(h) },
    { k: 'index_couleur', lib: 'Index fin couleur (A4)', test: h => estIndex(h) && !estCout(h) && estCouleur(h) && !estA3(h) },
    { k: 'index_couleur_a3', lib: 'Index fin couleur A3 (×2)', test: h => estIndex(h) && !estCout(h) && estCouleur(h) && estA3(h) },
    { k: 'montant', lib: 'Montant (€ HT)', test: h => /total\s*co[uû]t|montant|total\s*ht|prix\s*total/.test(h) },
    { k: 'statut', lib: 'Statut (info)', test: h => /^statut/.test(h) },
    { k: 'commentaire', lib: 'Commentaire (info)', test: h => /commentaire|remarque|observation/.test(h) },
];
const testChamp = (c, entete) => c.test(normTxt(entete));

function vueFacturation(el, params) {
    if (baseVide()) return messageBaseVide(el);
    const periodes = periodesConso();
    const trimestres = [...new Map(periodes.map(p => [trimestreDe(p).code, trimestreDe(p)])).values()];
    if (params.periode) {
        const t = trimestres.find(x => x.code === params.periode);
        if (t) factu = { fournisseur: (factu && factu.fournisseur) || 'SCC', debut: t.debut, fin: t.fin };
    }
    if (!factu) {
        let t = trimestreDe(periodes[0]);
        if (periodes[0] !== t.fin && trimestres.length > 1) t = trimestres[1];
        factu = { fournisseur: 'SCC', debut: t.debut, fin: t.fin };
    }
    const opts = listePeriodes(periodes[periodes.length - 1], periodes[0]).reverse().map(p => [p, libMois(p)]);
    el.innerHTML = `
        <h2>Vérification de la facturation</h2>
        <p class="sous-titre">Comparez la facture du fournisseur avec la consommation calculée à partir de Kpax.</p>
        <div class="carte"><div class="row g-2 align-items-end">
            <div class="col-auto"><label class="form-label small">Fournisseur</label>
                <select class="form-select form-select-sm" id="f-four">${optionsHTML([['SCC', 'SCC'], ['EMC', 'EMC-Konica']], factu.fournisseur)}</select></div>
            <div class="col-auto"><label class="form-label small">Trimestre</label>
                <select class="form-select form-select-sm" id="f-trim" onchange="if(this.value){const [d,f]=this.value.split('|');document.getElementById('f-debut').value=d;document.getElementById('f-fin').value=f;}">
                ${optionsHTML(trimestres.map(t => [`${t.debut}|${t.fin}`, t.libelle]), `${factu.debut}|${factu.fin}`, 'Personnalisé')}</select></div>
            <div class="col-auto"><label class="form-label small">ou du mois</label><select class="form-select form-select-sm" id="f-debut">${optionsHTML(opts, factu.debut)}</select></div>
            <div class="col-auto"><label class="form-label small">au mois (inclus)</label><select class="form-select form-select-sm" id="f-fin">${optionsHTML(opts, factu.fin)}</select></div>
            <div class="col-auto"><button class="btn btn-sm btn-success" onclick="factu={fournisseur:document.getElementById('f-four').value,debut:document.getElementById('f-debut').value,fin:document.getElementById('f-fin').value};factureLue=null;afficherVue('facturation')">Afficher</button></div>
        </div></div>
        <div id="f-avert"></div>
        <div class="carte" id="f-facture"></div>
        <div class="carte" id="f-resultat"></div>`;
    rendreFacturation();
}

// Consommation calculée par machine sur la période
function consoPeriode(fournisseur, debut, fin) {
    const lignes = q(`SELECT * FROM consommation WHERE fournisseur=? AND periode BETWEEN ? AND ? ORDER BY numero_de_serie, periode`, [fournisseur, debut, fin]);
    const m = new Map();
    for (const l of lignes) {
        let a = m.get(l.numero_de_serie);
        if (!a) {
            a = { serie: l.numero_de_serie, source: l.source, constructeur: l.constructeur, modele: l.modele,
                  debutMono: l.compteur_mono_debut, debutCouleur: l.compteur_couleur_debut, mono: 0, couleur: 0, statuts: new Set(), corrige: 0 };
            m.set(l.numero_de_serie, a);
        }
        a.mono += l.volume_pages_mono || 0;
        a.couleur += l.volume_pages_couleur || 0;
        a.finMono = l.compteur_mono_fin;
        a.finCouleur = l.compteur_couleur_fin;
        a.source = l.source;
        if (STATUTS_A_VERIFIER.includes(l.statut)) a.statuts.add(l.statut);
        if (l.corrige) a.corrige = 1;
    }
    return [...m.values()].map(a => ({ ...a, statuts: [...a.statuts].join(', ') }));
}

function facturesEnregistrees() {
    return q(`SELECT * FROM factures WHERE fournisseur=? AND periode_debut=? AND periode_fin=?`, [factu.fournisseur, factu.debut, factu.fin]);
}

function rendreFacturation() {
    const { fournisseur, debut, fin } = factu;
    // Avertissement si le relevé de fin de période manque
    const maxP = q1('SELECT MAX(periode) AS p FROM consommation WHERE fournisseur=?', [fournisseur]).p;
    const av = [];
    if (!maxP) av.push(`Aucune consommation calculée pour ${esc(fournisseur)}.`);
    else if (maxP < fin) av.push(`La consommation de ${esc(libMois(decalerMois(maxP, 1)))} à ${esc(libMois(fin))} n'est pas encore calculable :
        il manque le relevé de ${esc(libMois(decalerMois(maxP, 2)))} (la conso d'un mois se calcule avec le relevé du mois suivant).`);
    document.getElementById('f-avert').innerHTML = av.length ? alerte('warning', av.join('<br>')) : '';

    const calc = consoPeriode(fournisseur, debut, fin);
    const enreg = facturesEnregistrees();
    const titre = `${esc(fournisseur)} · ${esc(libMois(debut))} → ${esc(libMois(fin))}`;

    // --- Bloc facture
    const fEl = document.getElementById('f-facture');
    if (factureLue) {
        rendreMappage(fEl);
    } else {
        fEl.innerHTML = `<h3><i class="fas fa-file-invoice me-2"></i>Facture du fournisseur</h3>
            ${enreg.length ? `<p class="mb-2">Facture enregistrée pour cette période : <b>${esc(enreg[0].fichier)}</b> (${nf(enreg.length)} lignes, importée le ${esc(enreg[0].importe_le)}).
                <button class="btn btn-sm btn-link text-danger" onclick="supprimerFacture()">supprimer</button></p>` : ''}
            <label class="form-label small">${enreg.length ? 'Remplacer par un autre fichier' : 'Importer la facture détaillée'} (CSV ou Excel) :</label>
            <input type="file" class="form-control" accept=".csv,.txt,.xlsx,.xls,.ods" onchange="lireFacture(this.files[0])">
            <p class="aide mt-2 mb-0">Le fichier doit contenir une ligne par machine avec le n° de série. Si votre facture est en PDF,
            demandez au fournisseur l'annexe détaillée au format Excel/CSV.</p>`;
    }

    // --- Résultat
    const rEl = document.getElementById('f-resultat');
    if (!enreg.length) {
        rEl.innerHTML = `<h3>Consommation calculée : ${titre}</h3>
            ${resumeTotaux(calc)}
            ${tableHTML('t-calc', colonnesCalc(), calc, { nomFichier: `conso_${fournisseur}_${debut}_${fin}`, vide: 'Aucune consommation sur cette période.' })}`;
        return;
    }
    rendreComparaison(rEl, calc, enreg, titre);
}

function resumeTotaux(calc) {
    const m = calc.reduce((s, l) => s + l.mono, 0), c = calc.reduce((s, l) => s + l.couleur, 0);
    return `<div class="kpis"><div class="kpi"><div class="libelle">Machines</div><div class="valeur">${nf(calc.length)}</div></div>
        <div class="kpi"><div class="libelle">Pages mono</div><div class="valeur">${nf(m)}</div></div>
        <div class="kpi"><div class="libelle">Pages couleur</div><div class="valeur">${nf(c)}</div></div></div>`;
}

const lienSerie = k => l => l[k] ? `<a class="lien" onclick="afficherVue('machines',{serie:'${esc(l[k])}'})">${esc(l[k])}</a>` : '';

function colonnesCalc() {
    return [
        { k: 'source', t: 'Source' }, { k: 'constructeur', t: 'Constructeur' }, { k: 'modele', t: 'Modèle' },
        { k: 'serie', t: 'N° de série', html: lienSerie('serie') },
        { k: 'debutMono', t: 'Index début mono', type: 'n' }, { k: 'finMono', t: 'Index fin mono', type: 'n' },
        { k: 'mono', t: 'Pages mono', type: 'n', somme: true },
        { k: 'debutCouleur', t: 'Index début couleur', type: 'n' }, { k: 'finCouleur', t: 'Index fin couleur', type: 'n' },
        { k: 'couleur', t: 'Pages couleur', type: 'n', somme: true },
        { k: 'statuts', t: 'À vérifier' },
    ];
}

// ------------------------- Lecture de la facture -------------------------
async function lireFacture(file) {
    if (!file) return;
    try {
        if (/\.(xlsx|xls|ods)$/i.test(file.name)) {
            const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
            const feuilles = {};
            for (const n of wb.SheetNames) {
                feuilles[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true });
            }
            // Feuille par défaut : celle mémorisée, sinon la 1re qui a une colonne n° de série
            const memo = lireParametre(`feuille_facture_${factu.fournisseur}`, '');
            const feuille = feuilles[memo] ? memo
                : wb.SheetNames.find(n => feuilles[n].slice(0, 15).some(l => l.some(v => testChamp(CHAMPS_FACTURE[0], v)))) || wb.SheetNames[0];
            factureLue = { nom: file.name, feuilles, feuille };
        } else {
            factureLue = { nom: file.name, feuilles: { CSV: Papa.parse(await lireFichierTexte(file), { skipEmptyLines: 'greedy' }).data }, feuille: 'CSV' };
        }
        choisirFeuille(factureLue.feuille);
    } catch (e) {
        console.error(e);
        toast('Lecture de la facture impossible : ' + e.message, 'erreur');
    }
}

function choisirFeuille(nom) {
    factureLue.feuille = nom;
    factureLue.lignes = factureLue.feuilles[nom].map(l => l.map(v => typeof v === 'string' ? v.trim() : v));
    let entete = factureLue.lignes.findIndex(l => l.some(v => testChamp(CHAMPS_FACTURE[0], v)));
    if (entete < 0) entete = factureLue.lignes.findIndex(l => l.filter(v => v !== '').length >= 3);
    factureLue.ligneEntete = Math.max(entete, 0);
    rendreFacturation();
}

function rendreMappage(el) {
    const { lignes, ligneEntete, nom } = factureLue;
    const entetes = (lignes[ligneEntete] || []).map((v, i) => String(v || `Colonne ${i + 1}`));
    const memo = lireParametre(`mappage_facture_${factu.fournisseur}`, {});
    const choix = {};
    for (const c of CHAMPS_FACTURE) {
        const m = memo[c.k] !== undefined ? entetes.indexOf(memo[c.k]) : -1;
        choix[c.k] = m >= 0 ? m : entetes.findIndex(e => testChamp(c, e));
    }
    const apercu = lignes.slice(ligneEntete + 1, ligneEntete + 6);
    el.innerHTML = `<h3><i class="fas fa-table-columns me-2"></i>Colonnes de la facture « ${esc(nom)} »</h3>
        <div class="row g-2 align-items-end mb-2">
            ${Object.keys(factureLue.feuilles).length > 1 ? `<div class="col-auto"><label class="form-label small">Onglet</label>
                <select class="form-select form-select-sm" onchange="choisirFeuille(this.value)">${optionsHTML(Object.keys(factureLue.feuilles), factureLue.feuille)}</select></div>` : ''}
            <div class="col-auto"><label class="form-label small">Ligne des titres</label>
                <input type="number" min="1" class="form-control form-control-sm" style="width:6rem" value="${ligneEntete + 1}"
                onchange="factureLue.ligneEntete=Math.max(0,this.value-1);rendreFacturation()"></div>
            ${CHAMPS_FACTURE.map(c => `<div class="col-auto"><label class="form-label small">${esc(c.lib)}${c.obligatoire ? ' *' : ''}</label>
                <select class="form-select form-select-sm" id="map-${c.k}">${optionsHTML(entetes.map((e, i) => [i, e]), choix[c.k] >= 0 ? choix[c.k] : '', '— aucune —')}</select></div>`).join('')}
        </div>
        <p class="aide">Les colonnes A3 sont facultatives : si elles sont renseignées, les pages A3 comptent double (équivalent A4, comme dans le coût SCC).
            Le choix des colonnes est mémorisé pour les prochaines factures.</p>
        <p class="aide">Aperçu des premières lignes :</p>
        <div class="tableau-wrap mb-2"><table class="table table-sm table-bordered"><thead><tr>${entetes.map(e => `<th>${esc(e)}</th>`).join('')}</tr></thead>
        <tbody>${apercu.map(l => `<tr>${entetes.map((_, i) => `<td>${esc(l[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <button class="btn btn-success" onclick="enregistrerFacture()"><i class="fas fa-scale-balanced me-1"></i>Comparer avec ma consommation</button>
        <button class="btn btn-outline-secondary ms-2" onclick="factureLue=null;rendreFacturation()">Annuler</button>`;
}

async function enregistrerFacture() {
    const { lignes, ligneEntete, nom } = factureLue;
    const entetes = (lignes[ligneEntete] || []).map((v, i) => String(v || `Colonne ${i + 1}`));
    const idx = {}, memo = {};
    for (const c of CHAMPS_FACTURE) {
        const v = document.getElementById(`map-${c.k}`).value;
        idx[c.k] = v === '' ? -1 : Number(v);
        if (idx[c.k] >= 0) memo[c.k] = entetes[idx[c.k]];
    }
    if (idx.serie < 0) return toast('Indiquez la colonne du n° de série.', 'erreur');
    if (idx.mono < 0 && idx.couleur < 0 && idx.index_mono < 0) return toast('Indiquez au moins une colonne de volume ou d\'index.', 'erreur');
    const val = (l, k) => idx[k] >= 0 ? num(l[idx[k]]) : null;
    const txt = (l, k) => idx[k] >= 0 && l[idx[k]] !== '' ? String(l[idx[k]]) : null;
    // A4 + 2 × A3 (équivalent A4) ; null si aucune des deux colonnes n'est renseignée
    const equiv = (l, k) => { const a4 = val(l, k), a3 = val(l, k + '_a3'); return a4 === null && a3 === null ? null : (a4 || 0) + 2 * (a3 || 0); };

    // Regroupe par n° de série (une facture peut avoir plusieurs lignes par machine)
    const parSerie = new Map();
    for (const l of lignes.slice(ligneEntete + 1)) {
        const s = normSerie(l[idx.serie]);
        if (s.length < 4) continue;
        const a = parSerie.get(s) || { mono: null, couleur: null, index_mono: null, index_couleur: null, montant: null, statut: null, commentaire: null };
        for (const k of ['mono', 'couleur']) { const v = equiv(l, k); if (v !== null) a[k] = (a[k] || 0) + v; }
        { const v = val(l, 'montant'); if (v !== null) a.montant = (a.montant || 0) + v; }
        for (const k of ['index_mono', 'index_couleur']) { const v = equiv(l, k); if (v !== null) a[k] = Math.max(a[k] ?? v, v); }
        for (const k of ['statut', 'commentaire']) { const v = txt(l, k); if (v) a[k] = a[k] ? `${a[k]} / ${v}` : v; }
        parSerie.set(s, a);
    }
    if (!parSerie.size) return toast('Aucune ligne avec un n° de série trouvée : vérifiez la ligne des titres.', 'erreur');

    const date = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    transaction(() => {
        run('DELETE FROM factures WHERE fournisseur=? AND periode_debut=? AND periode_fin=?', [factu.fournisseur, factu.debut, factu.fin]);
        for (const [s, a] of parSerie) {
            run(`INSERT INTO factures (fournisseur, periode_debut, periode_fin, numero_de_serie, volume_mono, volume_couleur,
                 index_mono_fin, index_couleur_fin, montant, statut, commentaire, fichier, importe_le) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [factu.fournisseur, factu.debut, factu.fin, s, a.mono, a.couleur, a.index_mono, a.index_couleur, a.montant, a.statut, a.commentaire, nom, date]);
        }
        ecrireParametre(`mappage_facture_${factu.fournisseur}`, memo);
        ecrireParametre(`feuille_facture_${factu.fournisseur}`, factureLue.feuille);
    });
    await sauvegarder();
    factureLue = null;
    toast(`Facture enregistrée : ${parSerie.size} machines.`);
    rendreFacturation();
}

async function supprimerFacture() {
    if (!confirm('Supprimer la facture enregistrée pour cette période ?')) return;
    run('DELETE FROM factures WHERE fournisseur=? AND periode_debut=? AND periode_fin=?', [factu.fournisseur, factu.debut, factu.fin]);
    await sauvegarder();
    rendreFacturation();
}

// ------------------------- Comparaison -------------------------
let seulementEcarts = false;

// Seuils de tolérance, propres à chaque fournisseur, enregistrés dans la base (table parametres).
// Un écart est significatif s'il dépasse À LA FOIS le nombre de pages et le pourcentage du volume calculé.
const SEUILS_DEFAUT = { pages: 20, pct: 2 };
function lireSeuils(fournisseur) {
    const s = lireParametre(`seuils_ecart_${fournisseur}`, null) || lireParametre('seuils_ecart', null) || {};
    return { ...SEUILS_DEFAUT, ...s };
}
async function majSeuil(champ, valeur) {
    const v = num(valeur);
    if (v === null || v < 0) return toast('Seuil invalide : saisir un nombre positif ou nul.', 'erreur');
    const s = lireSeuils(factu.fournisseur);
    s[champ] = v;
    ecrireParametre(`seuils_ecart_${factu.fournisseur}`, s);
    await sauvegarder();
    toast(`Seuils ${factu.fournisseur} enregistrés : ${nf(s.pages)} pages et ${nf(s.pct, 1)} %.`);
    rendreFacturation();
}
async function reinitialiserSeuils() {
    run('DELETE FROM parametres WHERE cle IN (?, ?)', [`seuils_ecart_${factu.fournisseur}`, 'seuils_ecart']);
    await sauvegarder();
    rendreFacturation();
}

function rendreComparaison(el, calc, factures, titre) {
    const s = lireSeuils(factu.fournisseur);
    const significatif = (ecart, base) => ecart !== null && Math.abs(ecart) > Math.max(s.pages, Math.abs(base || 0) * s.pct / 100);
    const aIndex = factures.some(f => f.index_mono_fin !== null);
    const aVol = factures.some(f => f.volume_mono !== null || f.volume_couleur !== null);

    const mCalc = new Map(calc.map(c => [c.serie, c]));
    const mFact = new Map(factures.map(f => [normSerie(f.numero_de_serie), f]));
    const series = [...new Set([...mCalc.keys(), ...mFact.keys()])];
    let lignes = series.map(serie => {
        const c = mCalc.get(serie), f = mFact.get(serie);
        const l = {
            serie, source: c ? c.source : '', modele: c ? c.modele : '',
            calcMono: c ? c.mono : null, factMono: f ? f.volume_mono : null,
            calcCouleur: c ? c.couleur : null, factCouleur: f ? f.volume_couleur : null,
            calcIndexMono: c ? c.finMono : null, factIndexMono: f ? f.index_mono_fin : null,
            calcIndexCouleur: c ? c.finCouleur : null, factIndexCouleur: f ? f.index_couleur_fin : null,
            montant: f ? f.montant : null, statuts: c ? c.statuts : '',
            statutFact: f ? f.statut || '' : '', commentaire: f ? f.commentaire || '' : '',
        };
        l.ecartMono = c && f && f.volume_mono !== null ? f.volume_mono - c.mono : null;
        l.ecartCouleur = c && f && f.volume_couleur !== null ? f.volume_couleur - c.couleur : null;
        l.ecartIndexMono = c && f && f.index_mono_fin !== null && c.finMono !== null ? f.index_mono_fin - c.finMono : null;
        if (!c) {
            const connue = q1(`SELECT MAX(dateCompteurs) AS d FROM kpax WHERE upper(replace(trim(numero_de_serie),' ',''))=?`, [serie]).d;
            const pages = (f.volume_mono || 0) + (f.volume_couleur || 0);
            l.ko = pages > 0;
            l.resultat = (connue ? `Hors calcul (dernier relevé Kpax ${libMois(connue)})` : 'Hors Kpax')
                + (pages > 0 ? ' — facturée' : ' — 0 page');
        } else if (!f) {
            l.resultat = (c.mono || c.couleur) ? 'Non facturée' : 'Non facturée (0 page)';
            l.ko = !!(c.mono || c.couleur);
        } else {
            // Les volumes priment ; l'index n'est décisif que si la facture ne donne pas de volume
            const ecartVolume = significatif(l.ecartMono, l.calcMono) || significatif(l.ecartCouleur, l.calcCouleur);
            const ecartIndex = l.ecartIndexMono !== null && Math.abs(l.ecartIndexMono) > s.pages;
            l.ko = ecartVolume || (!aVol && ecartIndex);
            l.resultat = l.ko ? 'Écart' : (ecartIndex ? 'OK (index différent)' : 'OK');
        }
        return l;
    });
    const nbKo = lignes.filter(l => l.ko).length;
    // Totaux calculés sur toutes les machines, avant le filtre "seulement les écarts"
    const totaux = {};
    for (const k of ['factMono', 'calcMono', 'factCouleur', 'calcCouleur']) totaux[k] = lignes.reduce((s, l) => s + (Number(l[k]) || 0), 0);
    const tot = k => totaux[k];
    lignes.sort((a, b) => (b.ko - a.ko) || Math.abs(b.ecartMono || 0) - Math.abs(a.ecartMono || 0));
    if (seulementEcarts) lignes = lignes.filter(l => l.ko);

    const clsEcart = k => l => l[k] === null ? '' : (significatif(l[k], l[k.replace('ecart', 'calc')]) ? 'ecart-ko' : 'ecart-ok');
    const cols = [
        { k: 'resultat', t: 'Résultat', html: l => `<span class="badge text-bg-${l.resultat.startsWith('OK') ? 'success' : l.ko ? 'danger' : 'secondary'}">${esc(l.resultat)}</span>` },
        { k: 'source', t: 'Source' }, { k: 'modele', t: 'Modèle' }, { k: 'serie', t: 'N° de série', html: lienSerie('serie') },
    ];
    if (aVol) cols.push(
        { k: 'calcMono', t: 'Mono calculé', type: 'n', somme: true }, { k: 'factMono', t: 'Mono facturé', type: 'n', somme: true },
        { k: 'ecartMono', t: 'Écart mono', type: 'n', somme: true, cls: clsEcart('ecartMono') },
        { k: 'calcCouleur', t: 'Couleur calculé', type: 'n', somme: true }, { k: 'factCouleur', t: 'Couleur facturé', type: 'n', somme: true },
        { k: 'ecartCouleur', t: 'Écart couleur', type: 'n', somme: true, cls: clsEcart('ecartCouleur') });
    if (aIndex) cols.push(
        { k: 'calcIndexMono', t: 'Index fin mono (Kpax)', type: 'n' }, { k: 'factIndexMono', t: 'Index fin mono (facture)', type: 'n' },
        { k: 'ecartIndexMono', t: 'Écart index', type: 'n', cls: l => l.ecartIndexMono && Math.abs(l.ecartIndexMono) > s.pages ? 'text-warning-emphasis fw-bold' : '' });
    if (factures.some(f => f.montant !== null)) cols.push({ k: 'montant', t: 'Montant facturé', type: 'n', dec: 2, somme: true });
    cols.push({ k: 'statuts', t: 'À vérifier (calcul)' });
    if (factures.some(f => f.statut)) cols.push({ k: 'statutFact', t: 'Statut (facture)' });
    if (factures.some(f => f.commentaire)) cols.push({ k: 'commentaire', t: 'Commentaire (facture)' });

    el.innerHTML = `<h3>Comparaison : ${titre}</h3>
        <div class="kpis">
            <div class="kpi"><div class="libelle">Machines en écart</div><div class="valeur ${nbKo ? 'text-danger' : 'text-success'}">${nf(nbKo)}</div>
                <div class="detail">sur ${nf(series.length)} machines</div></div>
            ${aVol ? `<div class="kpi"><div class="libelle">Mono facturé / calculé</div><div class="valeur">${nf(tot('factMono'))}</div>
                <div class="detail">calculé ${nf(tot('calcMono'))} · écart <b>${nf(tot('factMono') - tot('calcMono'))}</b></div></div>
            <div class="kpi"><div class="libelle">Couleur facturé / calculé</div><div class="valeur">${nf(tot('factCouleur'))}</div>
                <div class="detail">calculé ${nf(tot('calcCouleur'))} · écart <b>${nf(tot('factCouleur') - tot('calcCouleur'))}</b></div></div>` : ''}
        </div>
        <div class="row g-2 align-items-center mb-2 small">
            <div class="col-auto">Tolérance ${esc(factu.fournisseur)} : écart signalé s'il dépasse</div>
            <div class="col-auto"><input type="number" min="0" step="1" class="form-control form-control-sm" style="width:5.5rem" value="${s.pages}" onchange="majSeuil('pages', this.value)"></div>
            <div class="col-auto">pages <b>et</b></div>
            <div class="col-auto"><input type="number" min="0" step="0.5" class="form-control form-control-sm" style="width:5rem" value="${s.pct}" onchange="majSeuil('pct', this.value)"></div>
            <div class="col-auto">% du volume calculé</div>
            ${s.pages !== SEUILS_DEFAUT.pages || s.pct !== SEUILS_DEFAUT.pct
                ? `<div class="col-auto"><a class="lien" onclick="reinitialiserSeuils()">valeurs par défaut (${SEUILS_DEFAUT.pages} pages, ${SEUILS_DEFAUT.pct} %)</a></div>` : ''}
            <div class="col-auto form-check ms-3"><input type="checkbox" class="form-check-input" id="f-ko" ${seulementEcarts ? 'checked' : ''}
                onchange="seulementEcarts=this.checked;rendreFacturation()"><label for="f-ko" class="form-check-label">Seulement les écarts</label></div>
        </div>
        ${tableHTML('t-comparaison', cols, lignes, { nomFichier: `comparaison_${factu.fournisseur}_${factu.debut}_${factu.fin}`, clsLigne: l => l.ko ? 'ligne-ko' : '' })}
        <p class="aide mt-2 mb-0">Écart = facturé − calculé (positif : le fournisseur facture plus que Kpax). Volumes en équivalent A4 (A3 = 2 pages).
        Les petits écarts viennent souvent de la date des index : SCC relève au dernier jour du trimestre, Kpax le 1er du mois suivant ;
        ils se compensent d'un trimestre à l'autre. Pour un écart important : cliquez sur le n° de série, comparez les index et,
        si la facture est juste, saisissez une correction.</p>`;
}
