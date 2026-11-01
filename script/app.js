'use strict';
// =====================================================================
// Démarrage et navigation
// =====================================================================

const VUES = {
    tableau: vueTableau,
    import: vueImport,
    facturation: vueFacturation,
    budget: vueBudget,
    consommation: vueConsommation,
    controles: vueControles,
    machines: vueMachines,
    base: vueBase,
};

function afficherVue(nom, params = {}) {
    document.querySelectorAll('.nav-vue').forEach(a => a.classList.toggle('active', a.dataset.vue === nom));
    const el = document.getElementById('contenu');
    try {
        VUES[nom](el, params);
    } catch (e) {
        console.error(e);
        el.innerHTML = alerte('danger', `Erreur d'affichage : ${esc(e.message)}`);
    }
    window.scrollTo(0, 0);
}

document.querySelectorAll('.nav-vue').forEach(a => a.addEventListener('click', () => afficherVue(a.dataset.vue)));

(async function demarrer() {
    const el = document.getElementById('contenu');
    el.innerHTML = '<p class="text-muted">Chargement de la base…</p>';
    try {
        if (typeof initSqlJs === 'undefined') throw new Error("la bibliothèque sql.js n'a pas pu être chargée (connexion Internet nécessaire)");
        await restaurerBase();
    } catch (e) {
        console.error(e);
        el.innerHTML = alerte('danger', 'Démarrage impossible : ' + esc(e.message));
        return;
    }
    majStatutBase();
    majBadgeControles();
    afficherVue('tableau');
})();
