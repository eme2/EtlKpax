'use strict';
// =====================================================================
// Base SQLite (sql.js) : ouverture, structure, sauvegarde automatique
//
// La base est conservée automatiquement dans le navigateur (IndexedDB) :
// plus besoin de la recharger à chaque ouverture de l'application.
// Les données ne quittent jamais le poste. Il reste conseillé de
// télécharger régulièrement une copie (bouton en haut à droite).
// =====================================================================

let SQL = null;
let db = null;
let modifNonTelechargee = false;
let derniereMaj = null;

const SQLJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/';

async function initSQL() {
    if (!SQL) SQL = await initSqlJs({ locateFile: f => SQLJS_URL + f });
    return SQL;
}

// ------------------------- Requêtes -------------------------
function q(sql, params = []) {
    const st = db.prepare(sql);
    try {
        st.bind(params);
        const out = [];
        while (st.step()) out.push(st.getAsObject());
        return out;
    } finally {
        st.free();
    }
}
function q1(sql, params = []) { return q(sql, params)[0] || null; }
function run(sql, params = []) { db.run(sql, params); }
function transaction(fn) {
    run('BEGIN');
    try { const r = fn(); run('COMMIT'); return r; }
    catch (e) { run('ROLLBACK'); throw e; }
}
function tableExiste(nom) { return !!q1("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?", [nom]); }
function colonnesDe(table) { return q(`PRAGMA table_info("${table}")`).map(r => r.name); }
function baseVide() { return !db || !colonnesDe('kpax').includes('numero_de_serie') || !q1('SELECT 1 AS x FROM kpax LIMIT 1'); }

// ------------------------- Structure -------------------------
function migrer() {
    if (!tableExiste('kpax')) run('CREATE TABLE kpax (source TEXT, fournisseur TEXT, dateCompteurs TEXT)');
    if (colonnesDe('kpax').includes('numero_de_serie')) {
        run('CREATE INDEX IF NOT EXISTS idx_kpax_serie ON kpax(numero_de_serie, dateCompteurs)');
    }
    run('CREATE INDEX IF NOT EXISTS idx_kpax_lot ON kpax(fournisseur, source, dateCompteurs)');

    // L'ancienne table consommation (version ETLv6) est mise de côté : elle est
    // désormais entièrement recalculée à partir de kpax + corrections.
    if (tableExiste('consommation') && !colonnesDe('consommation').includes('periode')) {
        if (tableExiste('consommation_ancienne')) run('DROP TABLE consommation_ancienne');
        run('ALTER TABLE consommation RENAME TO consommation_ancienne');
    }
    // consommation est une table calculée : si sa structure a changé, on la recrée
    const sqlConso = (q1("SELECT sql FROM sqlite_master WHERE type='table' AND name='consommation'") || {}).sql;
    if (sqlConso && !sqlConso.includes('PRIMARY KEY (fournisseur, numero_de_serie, periode)')) run('DROP TABLE consommation');
    run(`CREATE TABLE IF NOT EXISTS consommation (
            periode TEXT NOT NULL,              -- mois consommé AAAA-MM
            annee INTEGER, mois INTEGER,
            source TEXT, fournisseur TEXT, numero_de_serie TEXT NOT NULL,
            constructeur TEXT, modele TEXT, type_machine TEXT,
            compteur_mono_debut INTEGER, compteur_mono_fin INTEGER, volume_pages_mono INTEGER,
            compteur_couleur_debut INTEGER, compteur_couleur_fin INTEGER, volume_pages_couleur INTEGER,
            statut TEXT, detail TEXT, corrige INTEGER DEFAULT 0, date_releve TEXT,
            PRIMARY KEY (fournisseur, numero_de_serie, periode))`);

    // Corrections manuelles : remplacent (ou ajoutent) un relevé de compteur
    run(`CREATE TABLE IF NOT EXISTS corrections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_de_serie TEXT NOT NULL,
            date_compteurs TEXT NOT NULL,       -- relevé AAAA-MM concerné
            compteur_mono INTEGER,
            compteur_couleur INTEGER,
            commentaire TEXT,
            cree_le TEXT,
            UNIQUE (numero_de_serie, date_compteurs))`);
    // fournisseur concerné (vide = tous) : utile si une machine est chez SCC et EMC
    if (!colonnesDe('corrections').includes('fournisseur')) run('ALTER TABLE corrections ADD COLUMN fournisseur TEXT');

    // Objectifs annuels en pages et prix moyen par page
    run(`CREATE TABLE IF NOT EXISTS objectifs (
            annee INTEGER NOT NULL, source TEXT NOT NULL,
            pages_mono INTEGER, pages_couleur INTEGER,
            prix_mono REAL, prix_couleur REAL,
            PRIMARY KEY (annee, source))`);

    // Lignes de factures fournisseurs importées pour comparaison
    run(`CREATE TABLE IF NOT EXISTS factures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fournisseur TEXT, periode_debut TEXT, periode_fin TEXT,
            numero_de_serie TEXT, volume_mono INTEGER, volume_couleur INTEGER,
            index_mono_fin INTEGER, index_couleur_fin INTEGER, montant REAL,
            fichier TEXT, importe_le TEXT)`);

    run('CREATE TABLE IF NOT EXISTS parametres (cle TEXT PRIMARY KEY, valeur TEXT)');

    // Objectifs repris de la version précédente (codés en dur dans stats.js)
    if (!q1('SELECT 1 AS x FROM objectifs') && !baseVide()) {
        const an = (q1('SELECT MAX(dateCompteurs) AS d FROM kpax').d || String(new Date().getFullYear())).slice(0, 4);
        run('INSERT INTO objectifs VALUES (?,?,?,?,?,?)', [Number(an), 'EMS', 7834940, 2464393, 0, 0]);
        run('INSERT INTO objectifs VALUES (?,?,?,?,?,?)', [Number(an), 'ECOLE', 11814611, 219902, 0, 0]);
    }
}

function lireParametre(cle, defaut = null) {
    const r = q1('SELECT valeur FROM parametres WHERE cle=?', [cle]);
    if (!r) return defaut;
    try { return JSON.parse(r.valeur); } catch (e) { return defaut; }
}
function ecrireParametre(cle, valeur) {
    run('INSERT OR REPLACE INTO parametres (cle, valeur) VALUES (?, ?)', [cle, JSON.stringify(valeur)]);
}

// ------------------------- Stockage navigateur (IndexedDB) -------------------------
function idbOuvrir() {
    return new Promise((ok, ko) => {
        const r = indexedDB.open('etlkpax', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('fichiers');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
    });
}
async function idbOp(mode, fn) {
    const d = await idbOuvrir();
    return new Promise((ok, ko) => {
        const req = fn(d.transaction('fichiers', mode).objectStore('fichiers'));
        req.onsuccess = () => ok(req.result);
        req.onerror = () => ko(req.error);
    });
}

async function sauvegarder(telechargee = false) {
    if (!db) return;
    modifNonTelechargee = !telechargee;
    derniereMaj = new Date().toISOString();
    try {
        await idbOp('readwrite', s => s.put({ data: db.export(), maj: derniereMaj, nonTelechargee: modifNonTelechargee }, 'base'));
    } catch (e) {
        console.warn('Sauvegarde navigateur impossible', e);
        toast("La sauvegarde automatique dans le navigateur a échoué : pensez à télécharger la base.", 'erreur');
    }
    majStatutBase();
}

async function restaurerBase() {
    await initSQL();
    try {
        const enr = await idbOp('readonly', s => s.get('base'));
        if (enr && enr.data) {
            db = new SQL.Database(enr.data);
            migrer();
            modifNonTelechargee = !!enr.nonTelechargee;
            derniereMaj = enr.maj;
            return true;
        }
    } catch (e) {
        console.warn('Restauration impossible', e);
    }
    return false;
}

function nouvelleBase() {
    db = new SQL.Database();
    migrer();
}

async function ouvrirFichierBase(file) {
    await initSQL();
    const buf = new Uint8Array(await file.arrayBuffer());
    const nouvelle = new SQL.Database(buf);
    nouvelle.exec("SELECT name FROM sqlite_master"); // lève une erreur si ce n'est pas une base SQLite
    if (db) db.close();
    db = nouvelle;
    migrer();
    const res = recalculerConsommation();
    await sauvegarder(true);
    return res;
}

function telechargerBase() {
    if (!db) return;
    telecharger(new Blob([db.export()], { type: 'application/x-sqlite3' }), `etlkpax_${aujourdhui()}.sqlite`);
    sauvegarder(true);
    toast('Base téléchargée. Conservez ce fichier en lieu sûr (hors GitHub).');
}

async function effacerBase() {
    if (db) db.close();
    db = null;
    modifNonTelechargee = false;
    try { await idbOp('readwrite', s => s.delete('base')); } catch (e) { /* rien */ }
    majStatutBase();
}

function majStatutBase() {
    const el = document.getElementById('statut-base');
    if (!el) return;
    if (!db || baseVide()) {
        el.innerHTML = 'Aucune donnée chargée';
        return;
    }
    const r = q1('SELECT MAX(dateCompteurs) AS d, COUNT(DISTINCT numero_de_serie) AS n FROM kpax');
    const maj = derniereMaj ? new Date(derniereMaj).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    el.innerHTML = `${nf(r.n)} machines · dernier relevé <b>${esc(libMois(r.d))}</b>`
        + (maj ? ` · enregistré ${esc(maj)}` : '')
        + (modifNonTelechargee
            ? ` <button class="btn btn-warning ms-2" onclick="telechargerBase()" title="La base est enregistrée dans ce navigateur. Téléchargez une copie de sauvegarde."><i class="fas fa-download me-1"></i>Copie de sauvegarde</button>`
            : ` <button class="btn btn-outline-light ms-2" onclick="telechargerBase()"><i class="fas fa-download"></i></button>`);
}
