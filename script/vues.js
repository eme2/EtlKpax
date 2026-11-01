'use strict';
// =====================================================================
// Vues : tableau de bord, consommation, à vérifier, base de données
// =====================================================================

function messageBaseVide(el) {
    el.innerHTML = `
        <h2>Bienvenue</h2>
        <p class="sous-titre">Aucune donnée n'est encore chargée dans ce navigateur.</p>
        <div class="row g-3">
            <div class="col-md-6"><div class="carte h-100">
                <h3><i class="fas fa-database me-2"></i>J'ai déjà une base</h3>
                <p>Ouvrez votre fichier <code>.sqlite</code> : il sera ensuite conservé automatiquement dans ce navigateur.</p>
                <input type="file" class="form-control" accept=".sqlite,.db,.sqlite3" onchange="actionOuvrirBase(this.files[0])">
            </div></div>
            <div class="col-md-6"><div class="carte h-100">
                <h3><i class="fas fa-file-import me-2"></i>Je pars de zéro</h3>
                <p>Importez directement vos exports Kpax : la base est créée automatiquement.</p>
                <button class="btn btn-success" onclick="afficherVue('import')">Importer des fichiers Kpax</button>
            </div></div>
        </div>`;
}

async function actionOuvrirBase(file) {
    if (!file) return;
    try {
        const r = await ouvrirFichierBase(file);
        toast(`Base « ${file.name} » ouverte, consommation recalculée (${nf(r.lignes)} lignes).`);
        afficherVue('tableau');
    } catch (e) {
        console.error(e);
        toast("Impossible d'ouvrir ce fichier : " + e.message, 'erreur');
    }
}

// Périodes de consommation disponibles (AAAA-MM), de la plus récente à la plus ancienne
function periodesConso() {
    return q('SELECT DISTINCT periode FROM consommation ORDER BY periode DESC').map(r => r.periode);
}

// ------------------------- Tableau de bord -------------------------
function vueTableau(el) {
    if (baseVide()) return messageBaseVide(el);
    const der = q1('SELECT MAX(dateCompteurs) AS d FROM kpax').d;
    const prec = q1('SELECT MAX(dateCompteurs) AS d FROM kpax WHERE dateCompteurs < ?', [der]).d;
    const parc = d => {
        const m = {};
        for (const r of q('SELECT constructeur, source, COUNT(DISTINCT numero_de_serie) AS n FROM kpax WHERE dateCompteurs=? GROUP BY constructeur, source', [d])) {
            const k = `${r.source}|${typeMachine(r.constructeur)}`;
            m[k] = (m[k] || 0) + r.n;
        }
        return m;
    };
    const pDer = parc(der), pPrec = prec ? parc(prec) : {};
    const sources = q('SELECT DISTINCT source FROM kpax ORDER BY source').map(r => r.source);
    const delta = (k) => { const d = (pDer[k] || 0) - (pPrec[k] || 0); return d ? ` <span class="${d > 0 ? 'text-success' : 'text-danger'}">(${d > 0 ? '+' : ''}${d})</span>` : ''; };

    const derConso = q1('SELECT MAX(periode) AS p FROM consommation').p;
    let kpis = `<div class="kpi"><div class="libelle">Parc au relevé de ${esc(libMois(der))}</div>
        ${sources.map(s => `<div class="detail"><b>${esc(s)}</b> : ${nf(pDer[s + '|Imprimante'] || 0)} imprimantes${delta(s + '|Imprimante')},
         ${nf(pDer[s + '|Copieur'] || 0)} copieurs${delta(s + '|Copieur')}</div>`).join('')}
        ${prec ? `<div class="aide mt-1">écart par rapport à ${esc(libMois(prec))}</div>` : ''}</div>`;

    if (derConso) {
        const mois = q('SELECT source, SUM(volume_pages_mono) AS m, SUM(volume_pages_couleur) AS c FROM consommation WHERE periode=? GROUP BY source', [derConso]);
        kpis += `<div class="kpi"><div class="libelle">Pages imprimées en ${esc(libMois(derConso))}</div>
            ${mois.map(r => `<div class="detail"><b>${esc(r.source)}</b> : ${nf(r.m)} mono · ${nf(r.c)} couleur</div>`).join('')}</div>`;

        // Dernier trimestre complet (relevé du mois suivant disponible)
        let t = trimestreDe(derConso);
        if (derConso !== t.fin) t = trimestreDe(decalerMois(t.debut, -1));
        const trim = q('SELECT source, fournisseur, SUM(volume_pages_mono) AS m, SUM(volume_pages_couleur) AS c FROM consommation WHERE periode BETWEEN ? AND ? GROUP BY source, fournisseur', [t.debut, t.fin]);
        kpis += `<div class="kpi"><div class="libelle">Dernier trimestre complet : ${esc(t.libelle)}</div>
            ${trim.map(r => `<div class="detail"><b>${esc(r.source)}</b> ${esc(r.fournisseur)} : ${nf(r.m)} mono · ${nf(r.c)} couleur</div>`).join('') || '<div class="detail">—</div>'}
            <div class="mt-1"><a class="lien small" onclick="afficherVue('facturation',{periode:'${t.code}'})">Vérifier la facture ${esc(t.libelle)} →</a></div></div>`;

        // Budget de l'année
        const an = Number(derConso.slice(0, 4));
        const b = syntheseBudget(an);
        kpis += `<div class="kpi"><div class="libelle">Budget ${an} (projection fin d'année)</div>
            ${b.lignes.map(l => `<div class="detail"><b>${esc(l.source)}</b> : mono ${pct(l.ratioMono)} · couleur ${pct(l.ratioCouleur)} de l'objectif</div>`).join('') || '<div class="detail">Aucun objectif saisi</div>'}
            <div class="mt-1"><a class="lien small" onclick="afficherVue('budget')">Détail du budget →</a></div></div>`;
    }

    const nbVerif = Number(document.getElementById('badge-controles').textContent || 0);
    el.innerHTML = `
        <h2>Tableau de bord</h2>
        <p class="sous-titre">Situation au dernier relevé importé.</p>
        ${nbVerif ? alerte('warning', `<i class="fas fa-triangle-exclamation me-1"></i>${nbVerif} ligne(s) de consommation récentes à vérifier.
            <a class="lien" onclick="afficherVue('controles')">Voir</a>`) : ''}
        <div class="kpis">${kpis}</div>
        <div class="carte"><h3>Relevés importés</h3>${couvertureHTML()}</div>`;
}

// ------------------------- Consommation -------------------------
const REGROUPEMENTS = {
    machine: { lib: 'Machine', cols: ['source', 'fournisseur', 'constructeur', 'modele', 'numero_de_serie'] },
    modele: { lib: 'Modèle', cols: ['source', 'fournisseur', 'constructeur', 'modele'] },
    mois: { lib: 'Mois', cols: ['periode', 'source', 'fournisseur'] },
    source: { lib: 'Source / fournisseur', cols: ['source', 'fournisseur'] },
    type: { lib: 'Type de machine', cols: ['source', 'type_machine'] },
};
const LIBELLES = {
    source: 'Source', fournisseur: 'Fournisseur', constructeur: 'Constructeur', modele: 'Modèle',
    numero_de_serie: 'N° de série', periode: 'Mois', type_machine: 'Type',
};
let filtresConso = null;

function vueConsommation(el) {
    if (baseVide()) return messageBaseVide(el);
    const periodes = periodesConso();
    if (!filtresConso) {
        const t = trimestreDe(periodes[0]);
        filtresConso = { debut: t.debut < periodes[periodes.length - 1] ? periodes[periodes.length - 1] : t.debut, fin: periodes[0], source: '', fournisseur: '', groupe: 'modele', recherche: '' };
    }
    const f = filtresConso;
    const sources = q('SELECT DISTINCT source FROM consommation ORDER BY 1').map(r => r.source);
    const opts = periodes.map(p => [p, libMois(p)]);
    el.innerHTML = `
        <h2>Consommation</h2>
        <p class="sous-titre">Pages imprimées par période, calculées à partir des relevés Kpax et de vos corrections.</p>
        <div class="carte"><div class="row g-2 align-items-end">
            <div class="col-auto"><label class="form-label small">Du mois</label><select class="form-select form-select-sm" id="c-debut">${optionsHTML(opts, f.debut)}</select></div>
            <div class="col-auto"><label class="form-label small">au mois</label><select class="form-select form-select-sm" id="c-fin">${optionsHTML(opts, f.fin)}</select></div>
            <div class="col-auto"><label class="form-label small">Source</label><select class="form-select form-select-sm" id="c-source">${optionsHTML(sources, f.source, 'Toutes')}</select></div>
            <div class="col-auto"><label class="form-label small">Fournisseur</label><select class="form-select form-select-sm" id="c-four">${optionsHTML([['SCC', 'SCC'], ['EMC', 'EMC-Konica']], f.fournisseur, 'Tous')}</select></div>
            <div class="col-auto"><label class="form-label small">Regrouper par</label><select class="form-select form-select-sm" id="c-groupe">${optionsHTML(Object.entries(REGROUPEMENTS).map(([k, v]) => [k, v.lib]), f.groupe)}</select></div>
            <div class="col-auto"><label class="form-label small">Recherche (série, modèle)</label><input class="form-control form-control-sm" id="c-rech" value="${esc(f.recherche)}"></div>
            <div class="col-auto"><button class="btn btn-sm btn-success" onclick="appliquerFiltresConso()">Afficher</button></div>
            <div class="col-12 aide">Raccourcis :
                ${[...new Map(periodes.map(p => [trimestreDe(p).code, trimestreDe(p)])).values()].slice(0, 6).map(t =>
                    `<a class="lien me-2" onclick="filtresConso.debut='${t.debut}';filtresConso.fin='${t.fin}';afficherVue('consommation')">${t.libelle}</a>`).join('')}
                ${[...new Set(periodes.map(p => p.slice(0, 4)))].map(a => `<a class="lien me-2" onclick="filtresConso.debut='${a}-01';filtresConso.fin='${a}-12';afficherVue('consommation')">Année ${a}</a>`).join('')}
            </div>
        </div></div>
        <div class="carte" id="res-conso"></div>`;
    rendreConso();
}

function appliquerFiltresConso() {
    Object.assign(filtresConso, {
        debut: document.getElementById('c-debut').value, fin: document.getElementById('c-fin').value,
        source: document.getElementById('c-source').value, fournisseur: document.getElementById('c-four').value,
        groupe: document.getElementById('c-groupe').value, recherche: document.getElementById('c-rech').value.trim(),
    });
    rendreConso();
}

function rendreConso() {
    const f = filtresConso;
    let [debut, fin] = [f.debut, f.fin];
    if (debut > fin) [debut, fin] = [fin, debut];
    const g = REGROUPEMENTS[f.groupe];
    const where = ['periode BETWEEN ? AND ?'];
    const params = [debut, fin];
    if (f.source) { where.push('source = ?'); params.push(f.source); }
    if (f.fournisseur) { where.push('fournisseur = ?'); params.push(f.fournisseur); }
    if (f.recherche) { where.push('(numero_de_serie LIKE ? OR modele LIKE ?)'); params.push(`%${f.recherche}%`, `%${f.recherche}%`); }
    const lignes = q(`SELECT ${g.cols.join(', ')}, COUNT(DISTINCT numero_de_serie) AS nb_machines,
                        SUM(volume_pages_mono) AS mono, SUM(volume_pages_couleur) AS couleur,
                        SUM(CASE WHEN statut IN (${STATUTS_A_VERIFIER.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS a_verifier
                      FROM consommation WHERE ${where.join(' AND ')}
                      GROUP BY ${g.cols.join(', ')} ORDER BY ${g.cols.join(', ')}`, [...STATUTS_A_VERIFIER, ...params]);
    const colonnes = g.cols.map(c => c === 'numero_de_serie'
        ? { k: c, t: LIBELLES[c], html: l => `<a class="lien" onclick="afficherVue('machines',{serie:'${esc(l.numero_de_serie)}'})">${esc(l.numero_de_serie)}</a>` }
        : c === 'periode' ? { k: c, t: LIBELLES[c], html: l => esc(libMois(l.periode)) } : { k: c, t: LIBELLES[c] });
    if (f.groupe !== 'machine') colonnes.push({ k: 'nb_machines', t: 'Machines', type: 'n' });
    colonnes.push({ k: 'mono', t: 'Pages mono', type: 'n', somme: true }, { k: 'couleur', t: 'Pages couleur', type: 'n', somme: true },
        { k: 'a_verifier', t: 'À vérifier', type: 'n', html: l => l.a_verifier ? `<span class="badge text-bg-warning">${l.a_verifier}</span>` : '' });
    document.getElementById('res-conso').innerHTML =
        `<h3>${esc(libMois(debut))} → ${esc(libMois(fin))}</h3>` + tableHTML('t-conso', colonnes, lignes, { nomFichier: 'consommation' });
}

// ------------------------- À vérifier -------------------------
let periodeControles = '';

function vueControles(el) {
    if (baseVide()) return messageBaseVide(el);
    const periodes = periodesConso();
    if (!periodeControles) periodeControles = decalerMois(periodes[0], -2);
    const lignes = q(`SELECT * FROM consommation WHERE periode >= ? AND statut IN (${STATUTS_A_VERIFIER.map(() => '?').join(',')})
                      ORDER BY periode DESC, source, numero_de_serie`, [periodeControles, ...STATUTS_A_VERIFIER]);
    // Machines absentes du dernier relevé de leur lot (retirées ? panne ? non remontées ?)
    const absentes = q(`WITH der AS (SELECT fournisseur, source, MAX(dateCompteurs) AS d FROM kpax GROUP BY fournisseur, source),
                        mach AS (SELECT upper(replace(trim(numero_de_serie),' ','')) AS serie, fournisseur, source, MAX(dateCompteurs) AS d,
                                 MAX(modele) AS modele, MAX(constructeur) AS constructeur FROM kpax GROUP BY 1, fournisseur)
                        SELECT mach.* FROM mach JOIN der ON der.fournisseur = mach.fournisseur AND der.source = mach.source
                        WHERE mach.d < der.d AND mach.d >= ? AND length(mach.serie) >= 5 ORDER BY mach.d DESC`, [decalerMois(periodeControles, -1)]);
    // Machines présentes chez les deux fournisseurs au dernier relevé de chacun : risque de double facturation
    const SERIE = "upper(replace(trim(numero_de_serie),' ',''))";
    const doubles = q(`WITH der AS (SELECT fournisseur, MAX(dateCompteurs) AS d FROM kpax GROUP BY fournisseur),
                       actu AS (SELECT ${SERIE} AS serie, k.fournisseur, k.source, k.modele, k.constructeur, k.dateCompteurs AS d
                                FROM kpax k JOIN der ON der.fournisseur = k.fournisseur AND der.d = k.dateCompteurs
                                WHERE length(trim(k.numero_de_serie)) >= 5)
                       SELECT serie, MAX(constructeur) AS constructeur, MAX(modele) AS modele,
                              group_concat(fournisseur || ' (' || source || ', ' || d || ')', ' + ') AS ou
                       FROM actu GROUP BY serie HAVING COUNT(DISTINCT fournisseur) > 1 ORDER BY serie`);
    // Machines signalées déconnectées dans Kpax au dernier relevé (compteur potentiellement figé)
    const deconnectees = colonnesDe('kpax').includes('est_deconnecte') ? q(`
                       WITH der AS (SELECT fournisseur, source, MAX(dateCompteurs) AS d FROM kpax GROUP BY fournisseur, source)
                       SELECT ${SERIE} AS serie, k.fournisseur, k.source, k.constructeur, k.modele, k.derniere_mise_a_jour AS maj
                       FROM kpax k JOIN der ON der.fournisseur = k.fournisseur AND der.source = k.source AND der.d = k.dateCompteurs
                       WHERE lower(k.est_deconnecte) = 'oui' ORDER BY serie`) : [];
    // Machines lues avec la règle par défaut
    const defaut = q(`SELECT fournisseur, constructeur, COUNT(DISTINCT numero_de_serie) AS n FROM kpax GROUP BY fournisseur, constructeur`)
        .filter(r => compteursReleve({ fournisseur: r.fournisseur, constructeur: r.constructeur }).regle === 'défaut');

    const lienMachine = l => `<a class="lien" onclick="afficherVue('machines',{serie:'${esc(l.numero_de_serie || l.serie)}'})">${esc(l.numero_de_serie || l.serie)}</a>`;
    el.innerHTML = `
        <h2>À vérifier</h2>
        <p class="sous-titre">Cas particuliers détectés lors du calcul. Cliquez sur une machine pour voir son historique et la corriger si besoin.</p>
        <div class="carte"><div class="row g-2 align-items-end">
            <div class="col-auto"><label class="form-label small">Depuis le mois</label>
            <select class="form-select form-select-sm" onchange="periodeControles=this.value;afficherVue('controles')">${optionsHTML(periodes.map(p => [p, libMois(p)]), periodeControles)}</select></div>
        </div></div>
        ${doubles.length ? `<div class="carte border-danger"><h3 class="text-danger"><i class="fas fa-clone me-2"></i>Machines présentes chez les deux fournisseurs</h3>
        ${tableHTML('t-doubles', [
            { k: 'serie', t: 'N° de série', html: lienMachine }, { k: 'constructeur', t: 'Constructeur' }, { k: 'modele', t: 'Modèle' },
            { k: 'ou', t: 'Relevée chez' },
        ], doubles, { nomFichier: 'machines_deux_fournisseurs' })}
        <p class="aide mt-2 mb-0">Même n° de série dans le dernier export SCC et dans le dernier export EMC (profil « Géré ») :
        transfert en cours ou double gestion. Vérifiez qu'elle n'est pas facturée par les deux.</p></div>` : ''}
        <div class="carte"><h3>Consommations inhabituelles</h3>
        ${tableHTML('t-controles', [
            { k: 'periode', t: 'Mois', html: l => esc(libMois(l.periode)) },
            { k: 'statut', t: 'Statut', html: l => `<span class="badge text-bg-${l.statut === 'Compteur en baisse' ? 'danger' : 'warning'}">${esc(l.statut)}</span>` },
            { k: 'source', t: 'Source' }, { k: 'fournisseur', t: 'Fournisseur' }, { k: 'modele', t: 'Modèle' },
            { k: 'numero_de_serie', t: 'N° de série', html: lienMachine },
            { k: 'volume_pages_mono', t: 'Mono', type: 'n' }, { k: 'volume_pages_couleur', t: 'Couleur', type: 'n' },
            { k: 'detail', t: 'Détail' },
        ], lignes, { vide: 'Rien à signaler sur la période.', nomFichier: 'a_verifier' })}
        <p class="aide mt-2 mb-0"><b>Nouvelle</b> : tout le compteur est compté, vérifier qu'il s'agit bien d'une machine neuve ·
        <b>Relevé manquant</b> : compteur absent, rattrapé au mois suivant · <b>Rattrapage</b> : volume couvrant plusieurs mois ·
        <b>Compteur en baisse</b> : volume mis à 0 · <b>Déplacée</b> : changement ECOLE/EMS.</p></div>
        <div class="carte"><h3>Machines absentes du dernier relevé</h3>
        ${tableHTML('t-absentes', [
            { k: 'serie', t: 'N° de série', html: lienMachine }, { k: 'source', t: 'Source' }, { k: 'fournisseur', t: 'Fournisseur' },
            { k: 'constructeur', t: 'Constructeur' }, { k: 'modele', t: 'Modèle' }, { k: 'd', t: 'Dernier relevé', html: l => esc(libMois(l.d)) },
        ], absentes, { vide: 'Aucune.', nomFichier: 'machines_absentes' })}
        <p class="aide mt-2 mb-0">Machine retirée, en panne ou qui ne remonte plus dans Kpax : à signaler au fournisseur si elle est encore facturée.</p></div>
        ${deconnectees.length ? `<div class="carte"><h3>Machines déconnectées dans Kpax</h3>
        ${tableHTML('t-deconnectees', [
            { k: 'serie', t: 'N° de série', html: lienMachine }, { k: 'source', t: 'Source' }, { k: 'fournisseur', t: 'Fournisseur' },
            { k: 'constructeur', t: 'Constructeur' }, { k: 'modele', t: 'Modèle' }, { k: 'maj', t: 'Dernière mise à jour' },
        ], deconnectees, { nomFichier: 'machines_deconnectees' })}
        <p class="aide mt-2 mb-0">Kpax indique « Est déconnecté = Oui » au dernier relevé : le compteur peut être figé, la consommation sera rattrapée à la reconnexion.</p></div>` : ''}
        ${defaut.length ? `<div class="carte"><h3>Constructeurs sans règle spécifique</h3>
            <p class="small">Compteurs lus avec la règle par défaut (<code>total_mono</code> / <code>total_couleur</code>). À valider avec la facture du fournisseur
            (règles modifiables dans <code>script/regles.js</code>).</p>
            <ul class="mb-0">${defaut.map(d => `<li>${esc(d.fournisseur)} · ${esc(d.constructeur || '(vide)')} : ${nf(d.n)} machine(s)</li>`).join('')}</ul></div>` : ''}`;
}

// ------------------------- Base de données -------------------------
function vueBase(el) {
    const stats = db ? ['kpax', 'consommation', 'corrections', 'factures', 'objectifs'].filter(tableExiste)
        .map(t => [t, q1(`SELECT COUNT(*) AS n FROM "${t}"`).n]) : [];
    el.innerHTML = `
        <h2>Base de données</h2>
        <p class="sous-titre">La base est enregistrée automatiquement dans ce navigateur (rien n'est envoyé sur Internet).</p>
        <div class="row g-3">
            <div class="col-lg-6"><div class="carte h-100">
                <h3><i class="fas fa-download me-2"></i>Copie de sauvegarde</h3>
                <p>Téléchargez régulièrement une copie (après chaque import mensuel par exemple) et gardez-la sur un espace sécurisé.
                   Vider le cache du navigateur efface la base enregistrée.</p>
                <button class="btn btn-success" ${db ? '' : 'disabled'} onclick="telechargerBase()"><i class="fas fa-download me-1"></i>Télécharger la base</button>
            </div></div>
            <div class="col-lg-6"><div class="carte h-100">
                <h3><i class="fas fa-folder-open me-2"></i>Ouvrir une autre base</h3>
                <p>Remplace la base actuelle de ce navigateur par un fichier <code>.sqlite</code> (ex. une base ETLv6). La consommation est recalculée.</p>
                <input type="file" class="form-control" accept=".sqlite,.db,.sqlite3" onchange="if(confirmerRemplacement())actionOuvrirBase(this.files[0])">
            </div></div>
            <div class="col-lg-6"><div class="carte h-100">
                <h3><i class="fas fa-calculator me-2"></i>Recalcul</h3>
                <p>La consommation est recalculée automatiquement après chaque import et chaque correction. Ce bouton ne sert qu'en cas de doute.</p>
                <button class="btn btn-outline-secondary" ${db ? '' : 'disabled'} onclick="actionRecalcul()">Recalculer la consommation</button>
            </div></div>
            <div class="col-lg-6"><div class="carte h-100">
                <h3><i class="fas fa-circle-info me-2"></i>Contenu</h3>
                ${stats.length ? `<table class="table table-sm mb-2">${stats.map(([t, n]) => `<tr><td>${t}</td><td class="n">${nf(n)} lignes</td></tr>`).join('')}</table>` : '<p>Aucune base.</p>'}
                <button class="btn btn-sm btn-outline-danger" ${db ? '' : 'disabled'} onclick="actionEffacer()">Vider la base de ce navigateur</button>
            </div></div>
        </div>`;
}

function confirmerRemplacement() {
    return !db || baseVide() || !modifNonTelechargee
        || confirm("La base actuelle contient des modifications non téléchargées. La remplacer quand même ?");
}
async function actionRecalcul() {
    const r = recalculerConsommation();
    await sauvegarder();
    toast(`Consommation recalculée : ${nf(r.lignes)} lignes.`);
}
async function actionEffacer() {
    if (!confirm('Supprimer la base enregistrée dans ce navigateur ? (pensez à télécharger une copie avant)')) return;
    await effacerBase();
    afficherVue('base');
}
