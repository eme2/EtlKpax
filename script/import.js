'use strict';
// =====================================================================
// IMPORT DES EXPORTS KPAX (SCC et EMC-Konica)
//
// - plusieurs fichiers à la fois (glisser-déposer)
// - source (ECOLE/EMS), fournisseur et mois détectés depuis le nom du fichier,
//   modifiables avant import
// - réimporter un même mois REMPLACE les relevés existants (pas de doublons)
// - la consommation est recalculée et la base enregistrée automatiquement
// =====================================================================

let fichiersEnAttente = [];
const COLONNES_RESERVEES = ['source', 'fournisseur', 'dateCompteurs'];

function nettoyerEntete(nom) {
    let c = String(nom ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[\s\W-]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
    if (!c) return '';
    if (/^\d/.test(c)) c = 'c_' + c;
    if (COLONNES_RESERVEES.map(x => x.toLowerCase()).includes(c)) c = 'csv_' + c;
    return c;
}

function detecterSource(nom) {
    const n = nom.toUpperCase();
    if (n.includes('ECOLE')) return 'ECOLE';
    if (/(^|[^A-Z])EMS([^A-Z]|$)/.test(n)) return 'EMS';
    return '';
}
function detecterFournisseur(nom) {
    return /EMC|KONICA/i.test(nom) ? 'EMC' : 'SCC';
}
// SCC : ECOLE_KPAXManageReport.20251201.0713198483.1.csv
// EMC : 78-exportkpaxemc-<uuid>-2026-08-03-083732.csv
function detecterMois(nom) {
    let m = nom.match(/(20\d{2})-(0[1-9]|1[0-2])-(\d{2})/);
    if (!m) m = nom.match(/(?:^|\D)(20\d{2})(0[1-9]|1[0-2])([0-3]\d)(?:\D|$)/);
    return m ? `${m[1]}-${m[2]}` : '';
}

// Les exports EMC contiennent tout le parc (y compris les machines SCC) :
// on ne garde que le profil "Géré".
function motifExclusion(f, l) {
    if (!String(l.numero_de_serie ?? '').trim()) return 'sans n° de série';
    if (f.fournisseur === 'EMC' && 'profil' in l && !normTxt(l.profil).startsWith('gere')) return `profil « ${l.profil || 'vide'} »`;
    return null;
}
function lignesRetenues(f) { return f.lignes.filter(l => !motifExclusion(f, l)); }
function exclusions(f) {
    const m = {};
    for (const l of f.lignes) { const x = motifExclusion(f, l); if (x) m[x] = (m[x] || 0) + 1; }
    return Object.entries(m).map(([k, n]) => `${nf(n)} ${k}`).join(', ');
}

async function analyserFichier(file) {
    const f = {
        nom: file.name,
        source: detecterSource(file.name) || (db ? lireParametre(`source_${detecterFournisseur(file.name)}`, '') : ''),
        fournisseur: detecterFournisseur(file.name),
        dateCompteurs: detecterMois(file.name),
        lignes: [], colonnes: [], erreur: '',
    };
    try {
        const texte = await lireFichierTexte(file);
        const res = Papa.parse(texte, { header: true, skipEmptyLines: 'greedy', transformHeader: nettoyerEntete });
        f.colonnes = res.meta.fields.filter(c => c);
        f.lignes = res.data;
        if (!f.colonnes.includes('numero_de_serie')) {
            f.erreur = "Colonne « Numéro de série » introuvable : ce fichier n'est pas un export Kpax.";
        }
    } catch (e) {
        f.erreur = 'Lecture impossible : ' + e.message;
    }
    return f;
}

async function ajouterFichiers(files) {
    for (const file of files) {
        if (fichiersEnAttente.some(f => f.nom === file.name)) continue;
        fichiersEnAttente.push(await analyserFichier(file));
    }
    rendreAttente();
}

function etatFichier(f) {
    if (f.erreur) return { ok: false, html: `<span class="text-danger">${esc(f.erreur)}</span>` };
    if (!f.source) return { ok: false, html: '<span class="text-danger">Choisir la source</span>' };
    if (!estPeriode(f.dateCompteurs)) return { ok: false, html: '<span class="text-danger">Mois invalide (AAAA-MM)</span>' };
    const doublon = fichiersEnAttente.filter(x => x.source === f.source && x.fournisseur === f.fournisseur && x.dateCompteurs === f.dateCompteurs);
    if (doublon.length > 1) return { ok: false, html: '<span class="text-danger">Même lot qu\'un autre fichier</span>' };
    let existant = 0;
    if (db && colonnesDe('kpax').includes('numero_de_serie')) {
        existant = q1('SELECT COUNT(*) AS n FROM kpax WHERE source=? AND fournisseur=? AND dateCompteurs=?', [f.source, f.fournisseur, f.dateCompteurs]).n;
    }
    return existant
        ? { ok: true, html: `<span class="text-warning-emphasis"><i class="fas fa-rotate me-1"></i>Déjà importé : remplacera ${nf(existant)} relevé(s)</span>` }
        : { ok: true, html: '<span class="text-success"><i class="fas fa-check me-1"></i>Nouveau</span>' };
}

function rendreAttente() {
    const el = document.getElementById('attente');
    if (!el) return;
    if (!fichiersEnAttente.length) { el.innerHTML = ''; return; }
    const sources = [...new Set(['ECOLE', 'EMS', ...(db && !baseVide() ? q('SELECT DISTINCT source FROM kpax WHERE source IS NOT NULL').map(r => r.source) : [])])];
    let ok = true;
    let h = `<div class="carte"><h3><span class="etape">2</span>Vérifier puis importer</h3>
        <div class="tableau-wrap"><table class="table table-sm align-middle"><thead><tr>
        <th>Fichier</th><th>Source</th><th>Fournisseur</th><th>Mois des compteurs</th><th class="n">Machines retenues</th><th>État</th><th></th>
        </tr></thead><tbody>`;
    fichiersEnAttente.forEach((f, i) => {
        const e = etatFichier(f);
        ok = ok && e.ok;
        const total = f.lignes.length, ret = lignesRetenues(f).length;
        h += `<tr>
            <td class="small">${esc(f.nom)}</td>
            <td><select class="form-select form-select-sm" onchange="majAttente(${i},'source',this.value)">${optionsHTML(sources, f.source, '—')}</select></td>
            <td><select class="form-select form-select-sm" onchange="majAttente(${i},'fournisseur',this.value)">${optionsHTML([['SCC', 'SCC'], ['EMC', 'EMC-Konica']], f.fournisseur)}</select></td>
            <td><input class="form-control form-control-sm" style="width:7.5rem" value="${esc(f.dateCompteurs)}" placeholder="AAAA-MM" onchange="majAttente(${i},'dateCompteurs',this.value.trim())"></td>
            <td class="n" title="${total} lignes dans le fichier">${nf(ret)}${ret !== total ? `<div class="aide">sur ${nf(total)} lignes · écartées : ${esc(exclusions(f))}</div>` : ''}</td>
            <td class="small">${e.html}</td>
            <td><button class="btn btn-sm btn-link text-danger" title="Retirer" onclick="fichiersEnAttente.splice(${i},1);rendreAttente()"><i class="fas fa-xmark"></i></button></td>
        </tr>`;
    });
    h += `</tbody></table></div>
        <p class="aide mt-2 mb-2">Le <b>mois des compteurs</b> est celui du relevé (export de début de mois) : le relevé de mars sert à calculer la consommation de février.</p>
        <button class="btn btn-success" ${ok ? '' : 'disabled'} onclick="importerFichiers()"><i class="fas fa-file-import me-1"></i>Importer ${fichiersEnAttente.length} fichier(s) et calculer</button>
        <button class="btn btn-outline-secondary ms-2" onclick="fichiersEnAttente=[];rendreAttente()">Annuler</button>
        </div>`;
    el.innerHTML = h;
}

function majAttente(i, champ, val) {
    fichiersEnAttente[i][champ] = val;
    rendreAttente();
}

function typeNouvelleColonne(c) {
    return /^(total|mono|couleur|compteur|copie|impression|nb_|nombre)|_a3|_a4|a3_|a4_/.test(c) ? 'INTEGER' : 'TEXT';
}

function insererFichier(f) {
    const existantes = new Map(q('PRAGMA table_info(kpax)').map(r => [r.name, (r.type || '').toUpperCase()]));
    for (const c of f.colonnes) {
        if (!existantes.has(c)) {
            const t = typeNouvelleColonne(c);
            run(`ALTER TABLE kpax ADD COLUMN "${c}" ${t}`);
            existantes.set(c, t);
        }
    }
    run('DELETE FROM kpax WHERE source=? AND fournisseur=? AND dateCompteurs=?', [f.source, f.fournisseur, f.dateCompteurs]);
    const cols = [...COLONNES_RESERVEES, ...f.colonnes];
    const numeriques = new Set(f.colonnes.filter(c => /INT|REAL|NUM/.test(existantes.get(c))));
    const st = db.prepare(`INSERT INTO kpax (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    const lignes = lignesRetenues(f);
    try {
        for (const l of lignes) {
            const vals = [f.source, f.fournisseur, f.dateCompteurs];
            for (const c of f.colonnes) {
                let v = l[c];
                if (v === undefined || v === '') v = null;
                else if (numeriques.has(c)) { const n = num(v); v = n === null ? v : n; }
                else if (c === 'numero_de_serie') v = String(v).trim();
                vals.push(v);
            }
            st.run(vals);
        }
    } finally {
        st.free();
    }
    return lignes.length;
}

async function importerFichiers() {
    const res = document.getElementById('resultat-import');
    try {
        await initSQL();
        if (!db) nouvelleBase();
        const bilan = [];
        transaction(() => {
            for (const f of fichiersEnAttente) {
                bilan.push({ ...f, n: insererFichier(f) });
                if (!detecterSource(f.nom)) ecrireParametre(`source_${f.fournisseur}`, f.source);
            }
        });
        migrer(); // index sur numero_de_serie si nouvelle base
        const calc = recalculerConsommation();
        await sauvegarder();
        fichiersEnAttente = [];
        rendreAttente();
        res.innerHTML = alerte('success', `<b>Import terminé.</b><ul class="mb-1">${bilan.map(b =>
            `<li>${esc(b.source)} · ${esc(b.fournisseur)} · relevé de ${esc(libMois(b.dateCompteurs))} : ${nf(b.n)} machines</li>`).join('')}</ul>
            Consommation recalculée (${nf(calc.lignes)} lignes).
            ${calc.aVerifier ? `<a class="lien" onclick="afficherVue('controles')">${nf(calc.aVerifier)} ligne(s) à vérifier</a>.` : ''}
            La base est enregistrée dans ce navigateur.`);
        document.getElementById('couverture-import').innerHTML = couvertureHTML();
    } catch (e) {
        console.error(e);
        res.innerHTML = alerte('danger', `Erreur pendant l'import, rien n'a été modifié : ${esc(e.message)}`);
    }
}

function vueImport(el) {
    el.innerHTML = `
        <h2>Importer les exports Kpax</h2>
        <p class="sous-titre">Chaque fin de mois : déposez les exports SCC (ECOLE et EMS) et EMC-Konica. Tout le reste est automatique.</p>
        <div class="carte">
            <h3><span class="etape">1</span>Choisir les fichiers CSV</h3>
            <label class="zone-depot w-100" id="zone-depot">
                <i class="fas fa-cloud-arrow-up fa-2x mb-2 text-success"></i><br>
                Glissez les fichiers ici ou <u>cliquez pour les sélectionner</u> (plusieurs fichiers possibles)
                <input type="file" id="fichiers-kpax" accept=".csv,.txt" multiple hidden>
            </label>
            <p class="aide mt-2 mb-0">Détection automatique depuis le nom : <b>ECOLE</b>/<b>EMS</b> → source,
                <b>EMC</b> → fournisseur EMC-Konica (sinon SCC), date du fichier → mois du relevé.</p>
        </div>
        <div id="attente"></div>
        <div id="resultat-import"></div>
        <div class="carte"><h3>Relevés déjà importés</h3><div id="couverture-import">${couvertureHTML()}</div></div>`;

    const input = document.getElementById('fichiers-kpax');
    input.addEventListener('change', () => { ajouterFichiers([...input.files]); input.value = ''; });
    const zone = document.getElementById('zone-depot');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('survol'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('survol'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('survol'); ajouterFichiers([...e.dataTransfer.files]); });
    rendreAttente();
}

// Grille mois × lot montrant les relevés présents / manquants
function couvertureHTML(nbMois = 13) {
    if (!db || baseVide()) return '<p class="text-muted mb-0">Aucun relevé pour le moment.</p>';
    const lots = q(`SELECT fournisseur, source, dateCompteurs AS d, COUNT(DISTINCT numero_de_serie) AS n
                    FROM kpax GROUP BY fournisseur, source, dateCompteurs`);
    const cles = [...new Set(lots.map(l => `${l.fournisseur} · ${l.source}`))].sort();
    const max = lots.reduce((m, l) => l.d > m ? l.d : m, '');
    const min = lots.reduce((m, l) => l.d < m ? l.d : m, max);
    let debut = decalerMois(max, -(nbMois - 1));
    if (debut < min) debut = min;
    const mois = listePeriodes(debut, max).reverse();
    const idx = new Map(lots.map(l => [`${l.fournisseur} · ${l.source}|${l.d}`, l.n]));
    const premier = new Map();
    for (const l of lots) { const k = `${l.fournisseur} · ${l.source}`; if (!premier.has(k) || l.d < premier.get(k)) premier.set(k, l.d); }
    let h = `<div class="tableau-wrap"><table class="table table-sm table-bordered couverture"><thead><tr><th>Relevé</th>${cles.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`;
    for (const m of mois) {
        h += `<tr><th>${esc(libMois(m))}</th>`;
        for (const c of cles) {
            const n = idx.get(`${c}|${m}`);
            if (n) h += `<td class="ok">✓ ${nf(n)}</td>`;
            else if (m < premier.get(c)) h += '<td class="text-muted">–</td>';
            else h += '<td class="manque" title="Relevé manquant : la consommation sera reportée sur le mois suivant">manquant</td>';
        }
        h += '</tr>';
    }
    return h + '</tbody></table></div><p class="aide mb-0">Nombre de machines par relevé.</p>';
}
