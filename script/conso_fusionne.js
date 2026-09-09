//////////////////////////////////////////
// alimentation de la table consommation
//////////////////////////////////////////

// Fonction pour calculer les volumes selon le constructeur
function calculerVolumes(fournisseur, constructeur, row) {
    if (fournisseur == "SCC") {
        switch (constructeur) {
            case 'Brother':
                return {
                    mono: row.mono_recto_a4 + row.mono_r_v_a4 + 2 * (row.mono_recto_a3 + row.mono_r_v_a3),
                    couleur: row.couleur_recto_a4 + row.couleur_r_v_a4 + 2 * (row.couleur_recto_a3 + row.couleur_r_v_a3)
                };
            case 'Ricoh':
                return {
                    mono: row.source === 'EMS' ? row.total_mono : row.compteur_machine,
                    couleur: row.source === 'EMS' ? row.total_couleur : 0
                };
            case 'Lexmark':
                return {
                    mono: row.source === 'EMS' ? row.mono_a4 : row.total_mono,
                    couleur: row.source === 'EMS' ? row.couleur_a4 : row.total_couleur
                };
            default:
                return { mono: 0, couleur: 0 };
        }
    } else return { mono: 0, couleur: 0 };
}

// Un relevé est considéré "valide" s'il n'est ni nul, ni vide, ni égal à 0
// (un 0 étant, dans ce contexte, plus souvent le signe d'une donnée
// manquante que celui d'un compteur réellement remis à zéro).
function estValide(valeur) {
    return !(valeur == null || valeur === '' || valeur == 0);
}

//////////////////////////////////////////
// Fonction UNIQUE pour calculer et insérer la consommation mensuelle.
//
// Remplace calculerEtInsererConsommation() et traiteConsoMoisManquants() :
// - calculerConsommation()      -> ne (ré)écrit que les mois pas encore
//                                   présents dans consommation (mode incrémental)
// - calculerConsommation(true)  -> recalcule tous les mois connus de kpax,
//                                   y compris ceux déjà présents (mode recalcul
//                                   complet, via INSERT OR REPLACE)
//
// Dans les deux cas, on parcourt tout l'historique de chaque machine, TOUTES
// SOURCES CONFONDUES (EMS / École...), afin de reporter correctement le
// dernier compteur valide connu d'un mois sur l'autre, y compris à travers un
// changement de source (voir calculerConsommationMachine). Seul le fait
// d'écrire ou non le résultat en base diffère selon le mode.
//////////////////////////////////////////
function calculerConsommation(recalculTotal = false) {
    if (!checkDB(db, 'Conso')) return;

    let html = recalculTotal
        ? '<h3>Recalcul complet de la consommation</h3><p>'
        : '<h3>Traitement des mois manquants</h3><p>';

    // En mode incrémental, on ne réécrit pas les mois déjà présents dans
    // consommation (liste globale, tous fournisseurs/machines confondus).
    let moisExistants = new Set();
    if (!recalculTotal) {
        const consoMoisResult = db.exec(`
            SELECT DISTINCT printf('%04d-%02d', annee, mois) AS annee_mois
            FROM consommation
        `);
        if (consoMoisResult.length > 0) {
            for (const row of consoMoisResult[0].values) {
                moisExistants.add(row[0]);
            }
        }
    }

    try {
        // 1. Récupérer la liste des machines (une seule ligne par numero_de_serie,
        // même si la machine a été vue sous plusieurs "source" - EMS/École...)
        const machinesResult = db.exec(`
            SELECT numero_de_serie, MIN(constructeur) AS constructeur, MIN(fournisseur) AS fournisseur
            FROM kpax
            WHERE numero_de_serie IS NOT NULL AND length(numero_de_serie) >= 5
            GROUP BY numero_de_serie
            ORDER BY numero_de_serie
        `);
        const machines = [];
        if (machinesResult.length > 0) {
            const columns = machinesResult[0].columns;
            for (const row of machinesResult[0].values) {
                const obj = {};
                for (let i = 0; i < columns.length; i++) {
                    obj[columns[i]] = row[i];
                }
                machines.push(obj);
            }
        }

        html += `Trouvé ${machines.length} machines dans la base de données.</p>`;
        displayResults(html, 'Conso');

        // 701725140XP3R
        // Cette machine n'a pas de conso avant Août.
        // C359P600643 : passée d'EMS à Ecole -> traité désormais via le report
        // du dernier compteur valide + détection de changement de source
        // (statut "Nouvelle") dans calculerConsommationMachine.

        let rowsInserted = 0;
        for (const machine of machines) {
            rowsInserted += calculerConsommationMachine(machine, moisExistants, recalculTotal);
        }

        html += `<p>${rowsInserted} enregistrement(s) ajouté(s).</p>`;
        exportDatabase(html, 'Conso');
    } catch (err) {
        html += `<p class='error'>❌ Erreur lors du calcul de la consommation : ${err.message}</p>`;
        displayResults(html, 'Conso');
        console.error("Erreur lors du calcul de la consommation mensuelle :", err);
    }
}

//////////////////////////////////////////
// Calcule et insère la consommation mensuelle d'UNE machine (numero_de_serie),
// en parcourant tout son historique de relevés kpax dans l'ordre
// chronologique, toutes sources confondues (EMS / École...).
//
// Garde-fou anti-données-manquantes : on ne met à jour le "dernier compteur
// valide connu" (dernierMonoValide / dernierCouleurValide) que lorsque le
// relevé courant est exploitable (cf. estValide). Tant qu'un compteur reste
// manquant, on continue de reporter cette dernière valeur connue de mois en
// mois. Quand un relevé valide réapparaît - même plusieurs mois plus tard,
// ou sous une autre source - le delta est calculé par rapport à cette
// dernière valeur connue, ce qui restitue la consommation accumulée sur
// toute la période sans donnée au lieu d'un delta négatif ou aberrant.
//
// Changement de source (EMS <-> École, etc.) : le compteur physique continue,
// on ne réinitialise donc jamais dernierMonoValide/dernierCouleurValide à ce
// moment-là. On détecte simplement le changement (source du relevé courant
// différente de celle du relevé précédent) pour marquer le mois concerné en
// statut "Nouvelle" à titre indicatif, sans changer le calcul du volume.
//
// Retourne le nombre d'enregistrements insérés pour cette machine.
//////////////////////////////////////////
function calculerConsommationMachine(machine, moisExistants, recalculTotal) {
    const { numero_de_serie, constructeur, fournisseur } = machine;

    let query;
    if (constructeur === 'Brother') {
        query = `
            SELECT 
                source, modele, mono_recto_a4, mono_r_v_a4, mono_recto_a3, mono_r_v_a3,
                couleur_recto_a4, couleur_r_v_a4, couleur_recto_a3, couleur_r_v_a3,
                dateCompteurs, derniere_mise_a_jour
            FROM kpax 
            WHERE numero_de_serie = ?
            ORDER BY dateCompteurs
        `;
    } else {
        query = `
            SELECT 
                source, modele, mono_a4, couleur_a4, total_mono, total_couleur, compteur_machine,
                dateCompteurs, derniere_mise_a_jour
            FROM kpax 
            WHERE numero_de_serie = ?
            ORDER BY dateCompteurs
        `;
    }

    const compteursResult = db.exec(query, [numero_de_serie]);
    const compteurs = [];
    if (compteursResult.length > 0) {
        const columns = compteursResult[0].columns;
        for (const row of compteursResult[0].values) {
            const obj = {};
            for (let i = 0; i < columns.length; i++) {
                obj[columns[i]] = row[i];
            }
            compteurs.push(obj);
        }
    }

    if (compteurs.length === 0) return 0;

    let rowsInserted = 0;
    let dernierMonoValide = 0;
    let dernierCouleurValide = 0;
    let prevRow = null;
    let premierEnreg = true;

    // Insère (ou non) la ligne de consommation d'un mois donné, selon le mode
    // (recalcul complet, ou seulement les mois pas encore dans consommation).
    // Le filtre "> '2026-01'" reprend le comportement existant du mode
    // incrémental (ignore les mois antérieurs ou égaux à janvier 2026).
    function inserer(annee, mois, volumeMono, volumeCouleur, statut, dateReleve, sourceLigne, modeleLigne) {
        const cleMois = `${annee}-${String(mois).padStart(2, '0')}`;
        const doitTraiter = recalculTotal
            ? true
            : (!moisExistants.has(cleMois) && cleMois > '2026-01');
        if (!doitTraiter) return;

        db.run(
            `INSERT OR REPLACE INTO consommation 
            (source, fournisseur, numero_de_serie, constructeur, modele, annee, mois, volume_pages_mono, volume_pages_couleur, statut, date_releve) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sourceLigne, fournisseur, numero_de_serie, constructeur, modeleLigne,
             annee, mois, volumeMono, volumeCouleur, statut, dateReleve]
        );
        rowsInserted++;
    }

    for (const row of compteurs) {
        const [currentAnnee, currentMois] = row.dateCompteurs.split("-");
        const brut = calculerVolumes(fournisseur, constructeur, row);
        const monoValide = estValide(brut.mono);
        const couleurValide = estValide(brut.couleur);

        if (premierEnreg) {
            // Première apparition connue de cette machine : on insère une
            // ligne "Nouvelle" pour le mois précédent, avec tout le volume du
            // premier relevé comme consommation.
            const dt = new Date(currentAnnee, currentMois - 1, 1);
            dt.setMonth(dt.getMonth() - 1);
            const moisPrecedent = dt.toLocaleDateString('fr-CA', { year: 'numeric', month: '2-digit' });
            const [anneePrec, moisPrec] = moisPrecedent.split("-");

            inserer(anneePrec, moisPrec, brut.mono, brut.couleur, "Nouvelle", row.derniere_mise_a_jour, row.source, row.modele);

            dernierMonoValide = monoValide ? brut.mono : 0;
            dernierCouleurValide = couleurValide ? brut.couleur : 0;
            prevRow = row;
            premierEnreg = false;
            continue;
        }

        const [prevAnnee, prevMois] = prevRow.dateCompteurs.split("-");

        if (currentMois !== prevMois || currentAnnee !== prevAnnee) {
            // Le mois a changé : on calcule la consommation du mois précédent
            // en comparant avec le dernier compteur valide connu (potentiellement
            // plus ancien que le mois juste précédent, s'il y a eu des trous).
            const monoCloture = monoValide ? brut.mono : dernierMonoValide;
            const couleurCloture = couleurValide ? brut.couleur : dernierCouleurValide;

            const volumeMono = monoCloture - dernierMonoValide;
            const volumeCouleur = couleurCloture - dernierCouleurValide;

            // Changement de source détecté entre le relevé précédent et
            // celui-ci : le compteur continue (pas de remise à zéro), on se
            // contente de le signaler via le statut "Déplacée".
            const sourceAChange = row.source !== prevRow.source;
            const statut = sourceAChange
                ? "Déplacée"
                : (volumeMono > 0 || volumeCouleur > 0 ? "Active" : "Éteinte");

            // On enregistre la source/le modèle du relevé qui clôture le mois
            // précédent (donc ceux d'avant le changement, le cas échéant).
            inserer(prevAnnee, prevMois, volumeMono, volumeCouleur, statut, row.derniere_mise_a_jour, prevRow.source, prevRow.modele);
        }

        // On ne met à jour le dernier compteur "connu bon" que si le relevé
        // courant est exploitable ; sinon on continue de reporter l'ancienne
        // valeur pour les mois suivants, jusqu'à ce qu'un relevé valide revienne.
        if (monoValide) dernierMonoValide = brut.mono;
        if (couleurValide) dernierCouleurValide = brut.couleur;

        prevRow = row;
    }

    return rowsInserted;
}
