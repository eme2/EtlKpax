'use strict';
// =====================================================================
// RÈGLES DE LECTURE DES COMPTEURS
//
// Chaque export Kpax contient plusieurs compteurs ; selon le fournisseur,
// le constructeur et parfois la source (ECOLE / EMS), ce n'est pas le même
// compteur qui sert de référence pour la facturation.
//
// C'est LE seul endroit à modifier si une règle change ou si l'on découvre
// la méthode de calcul d'EMC-Konica.
// Chaque règle reçoit un relevé kpax (r) et renvoie { mono, couleur }
// (compteurs cumulés, pas des volumes).
// =====================================================================

// Somme de plusieurs compteurs : null si tous sont absents
function somme(...vals) {
    const v = vals.map(num).filter(x => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

const REGLES_COMPTEURS = {
    SCC: {
        Brother: r => ({
            mono: somme(r.mono_recto_a4, r.mono_r_v_a4, num(r.mono_recto_a3) * 2, num(r.mono_r_v_a3) * 2),
            couleur: somme(r.couleur_recto_a4, r.couleur_r_v_a4, num(r.couleur_recto_a3) * 2, num(r.couleur_r_v_a3) * 2),
        }),
        Ricoh: r => r.source === 'EMS'
            ? { mono: num(r.total_mono), couleur: num(r.total_couleur) }
            : { mono: num(r.compteur_machine), couleur: 0 },
        Lexmark: r => r.source === 'EMS'
            ? { mono: num(r.mono_a4), couleur: num(r.couleur_a4) }
            : { mono: num(r.total_mono), couleur: num(r.total_couleur) },
    },
    EMC: {
        // L'export EMC ne fournit que compteur_machine, total_mono et total_couleur
        // (compteur_machine = mono + couleur). La règle par défaut
        // (total_mono / total_couleur) s'applique, à confirmer avec la 1re facture EMC.
    },
};

// Règle utilisée quand aucune règle spécifique n'existe
function regleParDefaut(r) {
    const mono = num(r.total_mono) ?? num(r.compteur_machine);
    return { mono, couleur: num(r.total_couleur) };
}

function compteursReleve(r) {
    const regles = REGLES_COMPTEURS[r.fournisseur] || {};
    const cle = Object.keys(regles).find(k => normTxt(k) === normTxt(r.constructeur));
    if (cle) return { ...regles[cle](r), regle: `${r.fournisseur} / ${cle}` };
    return { ...regleParDefaut(r), regle: 'défaut' };
}

// Imprimante ou copieur (multifonction) : utilisé pour les indicateurs
const CONSTRUCTEURS_COPIEURS = ['ricoh', 'konica', 'konica minolta', 'develop'];
function typeMachine(constructeur) {
    const c = normTxt(constructeur);
    return CONSTRUCTEURS_COPIEURS.some(x => c.startsWith(x)) ? 'Copieur' : 'Imprimante';
}

// Un compteur à 0 / vide est considéré comme une donnée manquante
function estValide(v) { return !(v === null || v === undefined || v === '' || Number(v) === 0); }
