'use strict';
// =====================================================================
// Fonctions utilitaires communes (formatage, dates, tableaux, export)
// =====================================================================

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Nombre formaté à la française (espaces de milliers)
function nf(v, dec = 0) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (isNaN(n)) return esc(v);
    return n.toLocaleString('fr-FR', { maximumFractionDigits: dec });
}
function eur(v) {
    return Number(v || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
function pct(v) {
    return isFinite(v) && v !== null ? (v * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %' : '–';
}

// Conversion robuste texte -> nombre ("1 234", "1234,5", "" ...)
function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const s = String(v).replace(/[\s  ]/g, '').replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
}

function normTxt(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function normSerie(s) {
    return String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

// ------------------------- Périodes "AAAA-MM" -------------------------
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function estPeriode(p) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(p || ''); }
function libMois(p) {
    if (!estPeriode(p)) return p || '';
    const [a, m] = p.split('-');
    return `${MOIS_COURTS[+m - 1]} ${a}`;
}
function decalerMois(p, n) {
    const [a, m] = p.split('-').map(Number);
    const t = a * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
function ecartMois(p1, p2) {
    const [a1, m1] = p1.split('-').map(Number);
    const [a2, m2] = p2.split('-').map(Number);
    return (a2 - a1) * 12 + (m2 - m1);
}
function trimestreDe(p) {
    const [a, m] = p.split('-').map(Number);
    const t = Math.floor((m - 1) / 3);
    return {
        code: `${a}-T${t + 1}`,
        libelle: `T${t + 1} ${a}`,
        debut: `${a}-${String(t * 3 + 1).padStart(2, '0')}`,
        fin: `${a}-${String(t * 3 + 3).padStart(2, '0')}`,
    };
}
function listePeriodes(debut, fin) {
    const out = [];
    if (!estPeriode(debut) || !estPeriode(fin)) return out;
    for (let p = debut; p <= fin; p = decalerMois(p, 1)) out.push(p);
    return out;
}
function aujourdhui() { return new Date().toISOString().slice(0, 10); }

// ------------------------- Interface -------------------------
function alerte(type, html) { return `<div class="alert alert-${type} py-2">${html}</div>`; }

function toast(msg, type = 'succes') {
    const el = document.createElement('div');
    el.className = `toast-msg ${type}`;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'erreur' ? 8000 : 4000);
}

function optionsHTML(valeurs, selection, avecVide) {
    let h = avecVide ? `<option value="">${esc(avecVide)}</option>` : '';
    for (const v of valeurs) {
        const [val, lib] = Array.isArray(v) ? v : [v, v];
        h += `<option value="${esc(val)}"${String(val) === String(selection ?? '') ? ' selected' : ''}>${esc(lib)}</option>`;
    }
    return h;
}

function lireFichierTexte(file) {
    return file.arrayBuffer().then(buf => {
        let txt;
        try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
        catch (e) { txt = new TextDecoder('windows-1252').decode(buf); }
        return txt.replace(/^﻿/, '');
    });
}

// ------------------------- Tableaux génériques -------------------------
// colonnes : [{ k: 'cle', t: 'Titre', type: 'n' | 't', somme: bool, html: (ligne) => '...', cls: (ligne) => '' }]
const TABLES = {};

function tableHTML(id, colonnes, lignes, options = {}) {
    TABLES[id] = { colonnes, lignes, options };
    return `<div id="wrap-${id}">${rendreTable(id)}</div>`;
}

function rendreTable(id) {
    const { colonnes, lignes, options } = TABLES[id];
    if (!lignes.length) return `<p class="text-muted fst-italic mb-0">${esc(options.vide || 'Aucune donnée.')}</p>`;
    let h = '';
    if (options.export !== false) {
        h += `<div class="d-flex justify-content-between align-items-center mb-1">
                <span class="aide">${lignes.length} ligne(s)${options.tri ? '' : ' – cliquer sur un titre pour trier'}</span>
                <button class="btn btn-sm btn-outline-secondary" onclick="exporterTable('${id}')"><i class="fas fa-file-csv me-1"></i>Exporter (Excel)</button>
              </div>`;
    }
    h += `<div class="tableau-wrap"><table class="table table-sm table-hover table-striped" id="${id}"><thead><tr>`;
    for (const c of colonnes) {
        const fleche = TABLES[id].triCle === c.k ? (TABLES[id].triDesc ? ' ▼' : ' ▲') : '';
        h += `<th class="${c.type === 'n' ? 'n' : ''}" onclick="trierTable('${id}','${c.k}')" title="${esc(c.aide || '')}">${esc(c.t)}${fleche}</th>`;
    }
    h += '</tr></thead><tbody>';
    for (const l of lignes) {
        const cls = options.clsLigne ? options.clsLigne(l) : '';
        h += `<tr class="${cls}">`;
        for (const c of colonnes) {
            const v = l[c.k];
            const contenu = c.html ? c.html(l) : (c.type === 'n' ? nf(v, c.dec || 0) : esc(v));
            const cl = (c.type === 'n' ? 'n ' : '') + (c.cls ? c.cls(l) : '');
            h += `<td class="${cl}">${contenu}</td>`;
        }
        h += '</tr>';
    }
    h += '</tbody>';
    if (colonnes.some(c => c.somme)) {
        h += '<tfoot><tr>';
        colonnes.forEach((c, i) => {
            if (c.somme) h += `<td class="n">${nf(lignes.reduce((s, l) => s + (Number(l[c.k]) || 0), 0), c.dec || 0)}</td>`;
            else h += `<td>${i === 0 ? 'Total' : ''}</td>`;
        });
        h += '</tr></tfoot>';
    }
    h += '</table></div>';
    return h;
}

function trierTable(id, cle) {
    const t = TABLES[id];
    t.triDesc = t.triCle === cle ? !t.triDesc : false;
    t.triCle = cle;
    const sens = t.triDesc ? -1 : 1;
    t.lignes.sort((a, b) => {
        const va = a[cle], vb = b[cle];
        if (typeof va === 'number' || typeof vb === 'number') return ((Number(va) || 0) - (Number(vb) || 0)) * sens;
        return String(va ?? '').localeCompare(String(vb ?? ''), 'fr') * sens;
    });
    document.getElementById(`wrap-${id}`).innerHTML = rendreTable(id);
}

// Export CSV lisible directement par Excel (séparateur ";" + BOM UTF-8)
function exporterTable(id) {
    const { colonnes, lignes, options } = TABLES[id];
    const cols = colonnes.filter(c => c.export !== false);
    const cell = v => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'number') return String(v).replace('.', ',');
        return `"${String(v).replace(/"/g, '""')}"`;
    };
    let csv = cols.map(c => cell(c.t)).join(';') + '\n';
    for (const l of lignes) csv += cols.map(c => cell(c.exportVal ? c.exportVal(l) : l[c.k])).join(';') + '\n';
    telecharger(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${options.nomFichier || id}_${aujourdhui()}.csv`);
}

function telecharger(blob, nom) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
