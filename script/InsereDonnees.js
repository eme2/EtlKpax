
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

// Fonction principale pour calculer et insérer la consommation mensuelle
function calculerEtInsererConsommation() {
    let html = '<h3>Calcul de la consommation</h3><p>';
    let rowsInserted = 0;
    if (!db) {
        html = "<p class='error'>❌ Aucune base chargée.</p>";
        displayResults(html, 'Conso');
        return;
    }

    try {
        // 1. Récupérer la liste des machines
        const machinesResult = db.exec(`SELECT DISTINCT numero_de_serie, constructeur, modele, source, fournisseur 
                                        FROM kpax ORDER BY numero_de_serie`);
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
        
        html += `Trouvé ${machines.length} machines dans la base de données.<p>`;


        // 2. Pour chaque machine, récupérer ses enregistrements triés par date
        for (const machine of machines) {
            const { numero_de_serie, constructeur, modele, source, fournisseur } = machine;
            // des enregistrements n'ont pas de numéro de série. On passe à l'enreg suivant
            if (!numero_de_serie || numero_de_serie.length <5) continue;
            let query;
                if (constructeur === 'Brother') {
                    query = `
                        SELECT 
                            source, mono_recto_a4, mono_r_v_a4, mono_recto_a3, mono_r_v_a3,
                            couleur_recto_a4, couleur_r_v_a4, couleur_recto_a3, couleur_r_v_a3,
                            dateCompteurs, derniere_mise_a_jour
                        FROM kpax 
                        WHERE numero_de_serie = ? AND source = ?
                        ORDER BY dateCompteurs
                    `;
                } else {
                    query = `
                        SELECT 
                            source, mono_a4, couleur_a4, total_mono, total_couleur, compteur_machine,
                            dateCompteurs, derniere_mise_a_jour
                        FROM kpax 
                        WHERE numero_de_serie = ? AND source = ?
                        ORDER BY dateCompteurs
                    `;
                }

            const compteursResult = db.exec(query, [numero_de_serie, source]);
            // if (numero_de_serie == '3100R412455' || numero_de_serie == '4601523412F6X') {
            //     console.log("Trouvé machine cherchée")
            // }
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

            //html += `Il y a  ${compteurs.length} enregistrement pour la machine ${numero_de_serie}<br>`;



            // 3. Parcourir les enregistrements pour calculer la consommation mensuelle
            let prevRow = null;
            let prevMois = null;
            let prevAnnee = null;
            let prevVolumes = { mono: 0, couleur: 0 };
            let currentAnnee, currentMois = 0;

            for (const row of compteurs) {
                let statut = "";
                // const date = new Date(row.derniere_mise_a_jour);
                // const currentMois = date.getMonth() + 1; // Mois (1-12)
                // const currentAnnee = date.getFullYear();

                // récupération de l'année et du mois des données du relevé
                [currentAnnee, currentMois] = row.dateCompteurs.split("-");
            
                // Calculer les volumes pour l'enregistrement actuel
                const currentVolumes = calculerVolumes(fournisseur, constructeur, row);

                // Si c'est le premier enregistrement pour cette machine
                if (!prevRow) {
                    // Insérer une ligne pour le mois de cet enregistrement (statut = "Nouvelle")
                    statut = "Nouvelle";
                    //html += "*** Nouvelle<br>";
                    // recherche du mois précédent
                    const dt = new Date(currentAnnee, currentMois - 1, 1);
                    dt.setMonth(dt.getMonth() - 1);
                    // Formater au format YYYY-MM ('%Y-%m')
                    const dtKpax = dt.toLocaleDateString('fr-CA', { year: 'numeric', month: '2-digit' });

                    result = db.run(
                        `INSERT OR REPLACE INTO consommation 
                        (source, fournisseur, numero_de_serie, constructeur, modele, annee, mois, volume_pages_mono, volume_pages_couleur, statut, date_releve) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [   source,
                            fournisseur,
                            numero_de_serie,
                            constructeur,
                            modele,
                            dtKpax.split("-")[0],
                            dtKpax.split("-")[1],
                            currentVolumes.mono, // tout le volume pour la première "apparition"
                            currentVolumes.couleur,
                            statut,
                            row.derniere_mise_a_jour
                        ]);

                }
                // Si le mois a changé
                else if (currentMois !== prevMois || currentAnnee !== prevAnnee) {
                    //html += "*** Existante<br>";
                    // Calculer la consommation pour le mois précédent
                    const volumeMono = currentVolumes.mono - prevVolumes.mono;
                    const volumeCouleur = currentVolumes.couleur - prevVolumes.couleur;
                    statut = volumeMono > 0 || volumeCouleur > 0 ? "Active" : "Éteinte";

                    // Insérer dans la table consommation
                    db.run(
                        `
                        INSERT OR REPLACE INTO consommation 
                        (source, fournisseur, numero_de_serie, constructeur, modele, annee, mois, volume_pages_mono, volume_pages_couleur, statut, date_releve) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `,
                        [
                            source,
                            fournisseur,
                            numero_de_serie,
                            constructeur,
                            modele,
                            prevAnnee,
                            prevMois,
                            volumeMono,
                            volumeCouleur,
                            statut,
                            row.derniere_mise_a_jour
                        ]);
                }
                rowsInserted++;
                //html += `- machine ${numero_de_serie} (${statut}) mono ${currentVolumes.mono} couleur ${currentVolumes.couleur} pour ${currentAnnee}-${currentMois}<br>`;
 
                // Mettre à jour les variables pour l'itération suivante
                prevRow = row;
                prevMois = currentMois;
                prevAnnee = currentAnnee;
                prevVolumes = currentVolumes;
            }// for const row of dataMachines
            //displayResults(html, 'Conso');
        } // for machine
        //displayResults(html, 'Conso');
        html += `${rowsInserted} enregistrements ajoutés`;
        exportDatabase(html, 'Conso');
    } catch (err) {
         console.error("Erreur lors du calcul de la consommation mensuelle :", err);
    }
}


// Fonction pour afficher le dernier mois manquant toutes machines confondues
function afficherDernierMoisManquantGlobal() {
    let html = '<h3>Dernier mois manquant (toutes machines)</h3><p>';

    if (!db) {
        html = "<p class='error'>❌ Aucune base chargée.</p>";
        displayResults(html, 'Conso');
        return;
    }

    try {
        // 1. Récupérer tous les mois présents dans kpax
        const kpaxMoisResult = db.exec(`
            SELECT DISTINCT dateCompteurs AS annee_mois
            FROM kpax
            ORDER BY annee_mois
        `);

        const kpaxMois = [];
        if (kpaxMoisResult.length > 0) {
            for (const row of kpaxMoisResult[0].values) {
                kpaxMois.push(row[0]); // annee_mois
            }
        }

        // 2. Récupérer tous les mois présents dans consommation
        const consoMoisResult = db.exec(`
            SELECT DISTINCT printf('%04d-%02d', annee, mois) AS annee_mois
            FROM consommation
            ORDER BY annee_mois
        `);

        const consoMois = [];
        if (consoMoisResult.length > 0) {
            for (const row of consoMoisResult[0].values) {
                consoMois.push(row[0]); // annee_mois
            }
        }

        // 3. Trouver tous les mois manquants dans consommation
        const moisManquants = kpaxMois.filter(mois => !consoMois.includes(mois));

        // Ignorer si aucun mois manquant
        if (moisManquants.length === 0) {
            displayResults("<p>✅ Aucun mois manquant à traiter.</p>", 'Conso');
            return;
        }

        // 4. Récupérer le dernier mois de kpax
        const dernierMoisKpax = kpaxMois[kpaxMois.length - 1];

        // 5. Ignorer le dernier mois manquant s'il correspond au dernier mois de kpax (arrêté de compteur)
        const dernierMoisManquant = moisManquants[moisManquants.length - 1];
        if (dernierMoisManquant === dernierMoisKpax) {
            // Ce mois est un arrêté de compteur, on l'ignore
            if (moisManquants.length === 1) {
                displayResults("<p>✅ Aucun mois manquant à traiter (le dernier mois est un arrêté de compteur).</p>", 'Conso');
                return;
            }
            // Sinon, on prend l'avant-dernier mois manquant
            moisManquants.pop(); // Retirer le dernier mois manquant
        }

        // 6. Si aucun mois manquant utile, on affiche un message
        if (moisManquants.length === 0) {
            displayResults("<p>✅ Aucun mois manquant à traiter.</p>", 'Conso');
            return;
        }

        // 7. Afficher le dernier mois manquant utile
        const dernierMoisManquantUtile = moisManquants[moisManquants.length - 1];
        html += `🔍 Dernier mois manquant à traiter : <strong>${dernierMoisManquantUtile}</strong>`;
        displayResults(html, 'Conso');

    } catch (err) {
        html += `<p class='error'>❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'Conso');
        console.error("Erreur complète :", err);
    }
}

function traiteConsoMoisManquants() {
    if (!checkDB(db, 'Conso'))
        return;

    html = "<h3>Traitement des derniers mois manquants </h3><p>"
    try {
        // 1. Récupérer tous les mois présents dans kpax
        const kpaxMoisResult = db.exec(`
            SELECT DISTINCT dateCompteurs AS annee_mois
            FROM kpax
            ORDER BY annee_mois
        `);

        const kpaxMois = [];
        if (kpaxMoisResult.length > 0) {
            for (const row of kpaxMoisResult[0].values) {
                kpaxMois.push(row[0]); // annee_mois
            }
        }

        html += `<p>Mois trouvés dans Kpax : ${kpaxMois}`;

        // 2. Récupérer tous les mois présents dans consommation
        const consoMoisResult = db.exec(`
            SELECT DISTINCT printf('%04d-%02d', annee, mois) AS annee_mois
            FROM consommation
            ORDER BY annee_mois
        `);

        const consoMois = [];
        if (consoMoisResult.length > 0) {
            for (const row of consoMoisResult[0].values) {
                consoMois.push(row[0]); // annee_mois
            }
        }
 
        // 3. Trouver tous les mois manquants dans consommation
        const moisManquants = kpaxMois.filter(mois => (!consoMois.includes(mois)) && (mois > '2026-01'));

        // Ignorer si aucun mois manquant
        if (moisManquants.length === 0) {
            displayResults("<p>✅ Aucun mois manquant à traiter.</p>", 'Conso');
            return;
        }

        // 4. Récupérer le dernier mois de kpax
        const dernierMoisKpax = kpaxMois[kpaxMois.length - 1];

        // 5. Ignorer le dernier mois manquant s'il correspond au dernier mois de kpax (arrêté de compteur)
        const dernierMoisManquant = moisManquants[moisManquants.length - 1];
        if (dernierMoisManquant === dernierMoisKpax) {
            // Ce mois est un arrêté de compteur, on l'ignore
            if (moisManquants.length === 1) {
                displayResults("<p>✅ Aucun mois manquant à traiter (le dernier mois est un arrêté de compteur).</p>", 'Conso');
                return;
            }
            // Sinon, on prend l'avant-dernier mois manquant
            moisManquants.pop(); // Retirer le dernier mois manquant
        }

        html += `<p>Mois retenus corrigés : ${moisManquants}`;
        // 6. Si aucun mois manquant utile, on affiche un message
        if (moisManquants.length === 0) {
            displayResults("<p>✅ Aucun mois manquant à traiter.</p>", 'Conso');
            return;
        }

        for (mois of moisManquants) {
            traiteConsoUnMois(mois);
        }
    } catch(err) {
        html += `<p class='error'>❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'Conso');
    }


}

function traiteConsoUnMois(mois) {
    html += `<p><strong>Traite conso du mois ${mois}</strong>`;
    displayResults(html, 'Conso');

    try{
    // 7. Traiter uniquement le mois en paramètre
        const [annee, moisNum] = mois.split('-').map(Number);

        
        const dt = new Date(annee, moisNum - 1, 1);

        // 2. Ajouter 1 mois (gère automatiquement le changement d'année si on est en décembre)
        dt.setMonth(dt.getMonth() + 1);
 
        // 3. Formater au format YYYY-MM ('%Y-%m')
        const dtKpax = dt.toLocaleDateString('fr-CA', { year: 'numeric', month: '2-digit' });


        html += `<p>Recherche kpax du mois actuel et du mois suivant : ${mois} et ${dtKpax}`;


        // 8. Récupérer toutes les machines concernées par ce mois
        const machinesResult = db.exec(`
            SELECT DISTINCT numero_de_serie, constructeur, modele, source
            FROM kpax
            WHERE dateCompteurs = ?
            ORDER BY numero_de_serie
        `, [dtKpax]);

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

        html += `<p>Trouvé ${machines.length} machines`;

        // recherche des enregistrements kpax pour les deux derniers mois
        let query = ` SELECT
                        source, fournisseur, numero_de_serie, constructeur, dateCompteurs as dtCompteur, mono_recto_a4, mono_r_v_a4, mono_recto_a3, mono_r_v_a3,
                        couleur_recto_a4, couleur_r_v_a4, couleur_recto_a3, couleur_r_v_a3,
                        mono_a4, couleur_a4, total_mono, total_couleur, compteur_machine, derniere_mise_a_jour, modele

                        from kpax
                        where dateCompteurs = ? or dateCompteurs = ? 
                        order by numero_de_serie ASC, dateCompteurs DESC
            `;

        let compteursResult = db.exec(query, [mois, dtKpax]);

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

        if (compteurs.length === 0) {
            html += `⚠️ Aucun enregistrement trouvé pour ${numero_de_serie} en ${dernierMoisManquantUtile}.<br>`;
        }

        let precMachine = null;
        let cptMono = 0;
        let cptCouleur = 0;
        let etat = "";
        let i = 0;
        let rowsInserted = 0;
        let derdate = false;
        let precdate = false;
        let precRow = null;
        for (compteur of compteurs) {
            console.log("precMachine, machine actuelle : ", precMachine, compteur.numero_de_serie);
            if ((precMachine != null) && (precMachine != '') && (precMachine != compteur.numero_de_serie)) {
                // afficher et insérer les compteurs et l'état.
                // on a eu les deux dernières dates des compteurs
                if (precdate && derdate) {
                    console.log("Insertion d'une consommation : ", mois, precMachine, cptMono, cptCouleur, etat);
                    result = db.run(
                        `INSERT OR REPLACE INTO consommation 
                        (source, fournisseur, numero_de_serie, constructeur, modele, annee, mois, volume_pages_mono, volume_pages_couleur, statut, date_releve) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [   precRow.source,
                            precRow.fournisseur,
                            precRow.numero_de_serie,
                            precRow.constructeur,
                            precRow.modele,
                            mois.split("-")[0],
                            mois.split("-")[1],
                            cptMono, // Pas de consommation pour le premier mois
                            cptCouleur,
                            etat,
                            precRow.derniere_mise_a_jour
                        ]);
                    rowsInserted++;
                    html += `<br>Insertion pour ${mois} ${precMachine}, état ${etat}`;
                } else if (derdate && !precdate) {
                    // afficher la dernière date postérieure au 'mois' et calculer une conso éventuellement...
                    // revoir le calcul de la consommation pour y mettre la date correspondante du relevé kpax.
                    // -> certaines machines sont vue 1 ou 2 j avant la fin de mois.
                    // -> certaines sont effectivement arrêtées.
                    result = db.run(
                        `INSERT OR REPLACE INTO consommation 
                        (source, fournisseur, numero_de_serie, constructeur, modele, annee, mois, volume_pages_mono, volume_pages_couleur, statut, date_releve) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [   precRow.source,
                            precRow.fournisseur,
                            precRow.numero_de_serie,
                            precRow.constructeur,
                            precRow.modele,
                            mois.split("-")[0],
                            mois.split("-")[1],
                            cptMono, // Pas de consommation pour le premier mois
                            cptCouleur,
                            etat,
                            precRow.derniere_mise_a_jour
                        ]);
                    rowsInserted++;
                    html += `<p><strong> ❌ Vérifier si la machine ${precMachine} ${precRow.modele} - ${precRow.source} est nouvelle</strong>`;
                } else if (!derdate && precdate) {
                    html += `<p><strong> ❌ Machine ${precMachine} ${precRow.modele} - ${precRow.source} est éteinte (pas de conso en ${dtKpax})</strong>`;
                }
                
                
                derdate = precdate = false;
                cptMono = cptCouleur = 0;
                etat = "Eteinte";
            }
            if (compteur.numero_de_serie == '4601523412F6X') {
                console.log("trouvé 4601523412F6X");
            }
            console.log("Appel de calculer volume avec ", compteur.constructeur, compteur);
            const cpt = calculerVolumes(compteur.fournisseur, compteur.constructeur, compteur);
            console.log("Volume calculé ", cpt);

            // Compteur du dernier mois, on suppose que c'est une nouvelle machine
            if (compteur.dtCompteur == dtKpax) {
                etat = "Nouvelle";
                cptMono = cpt.mono;
                cptCouleur = cpt.couleur;
                derdate = true;
            // Compteur précédent
            } else if (compteur.dtCompteur == mois) {
                // on est sur la même machine
                if (precMachine == compteur.numero_de_serie) {
                    etat = "Active";
                    cptMono -= cpt.mono;
                    cptCouleur -= cpt.couleur;
                    precdate = true;
                } else {
                // machine différente
                }

            }
            precMachine = compteur.numero_de_serie;
            precRow = compteur;
            console.log("Compteurs : ", cptMono, cptCouleur, etat);
            i++;
            //if (i > 9) break;
        }

        html += `<p>${rowsInserted} enregistrements ajoutés`;
        exportDatabase(html, 'Conso');
    } catch(err) {
        html += `<p class='error'>❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'Conso');
    }
}

// Fonction pour traiter le dernier mois manquant utile (toutes machines confondues)
function traiterDernierMoisManquantOld() {
    let html = '<h3>Traitement du dernier mois manquant</h3><p>';
    let rowsInserted = 0;

    if (!db) {
        html = "<p class='error'>❌ Aucune base chargée.</p>";
        displayResults(html, 'Conso');
        return;
    }

    try {
        // 1. Récupérer tous les mois présents dans kpax
        const kpaxMoisResult = db.exec(`
            SELECT DISTINCT strftime('%Y-%m', derniere_mise_a_jour) AS annee_mois
            FROM kpax
            ORDER BY annee_mois
        `);

        const kpaxMois = [];
        if (kpaxMoisResult.length > 0) {
            for (const row of kpaxMoisResult[0].values) {
                kpaxMois.push(row[0]); // annee_mois
            }
        }

        // 2. Récupérer tous les mois présents dans consommation
        const consoMoisResult = db.exec(`
            SELECT DISTINCT printf('%04d-%02d', annee, mois) AS annee_mois
            FROM consommation
            ORDER BY annee_mois
        `);

        const consoMois = [];
        if (consoMoisResult.length > 0) {
            for (const row of consoMoisResult[0].values) {
                consoMois.push(row[0]); // annee_mois
            }
        }

        // 3. Trouver tous les mois manquants dans consommation
        const moisManquants = kpaxMois.filter(mois => !consoMois.includes(mois));

        // Ignorer si aucun mois manquant
        if (moisManquants.length === 0) {
            displayResults("<p>✅ Aucun mois manquant à traiter.</p>", 'Conso');
            return;
        }

        // 4. Récupérer le dernier mois de kpax
        const dernierMoisKpax = kpaxMois[kpaxMois.length - 1];

        // 5. Ignorer le dernier mois manquant s'il correspond au dernier mois de kpax (arrêté de compteur)
        const dernierMoisManquant = moisManquants[moisManquants.length - 1];
        if (dernierMoisManquant === dernierMoisKpax) {
            // Ce mois est un arrêté de compteur, on l'ignore
            if (moisManquants.length === 1) {
                displayResults("<p>✅ Aucun mois manquant à traiter (le dernier mois est un arrêté de compteur).</p>", 'Conso');
                return;
            }
            // Sinon, on prend l'avant-dernier mois manquant
            moisManquants.pop(); // Retirer le dernier mois manquant
        }

        // 6. Si aucun mois manquant utile, on affiche un message
        if (moisManquants.length === 0) {
            displayResults("<p>✅ Aucun mois manquant à traiter.</p>", 'Conso');
            return;
        }

        // 7. Traiter uniquement le dernier mois manquant utile
        const dernierMoisManquantUtile = moisManquants[moisManquants.length - 1];
        const [annee, moisNum] = dernierMoisManquantUtile.split('-').map(Number);

        html += `Traitement du mois <strong>${dernierMoisManquantUtile}</strong>...<br>`;

        // 8. Récupérer toutes les machines concernées par ce mois
        const machinesResult = db.exec(`
            SELECT DISTINCT numero_de_serie, constructeur, modele, source
            FROM kpax
            WHERE strftime('%Y-%m', derniere_mise_a_jour) = ?
            ORDER BY numero_de_serie
        `, [dernierMoisManquantUtile]);

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

        // 9. Pour chaque machine, calculer et insérer la consommation pour ce mois
        for (const machine of machines) {
            const { numero_de_serie, constructeur, modele, source } = machine;

            if (numero_de_serie == '3100R412455') {
                console.log("trouvé");
            }
            // Récupérer les enregistrements de kpax pour cette machine et ce mois
            let query;
            if (constructeur === 'Brother') {
                query = `
                    SELECT
                        source, mono_recto_a4, mono_r_v_a4, mono_recto_a3, mono_r_v_a3,
                        couleur_recto_a4, couleur_r_v_a4, couleur_recto_a3, couleur_r_v_a3,
                        derniere_mise_a_jour
                    FROM kpax
                    WHERE numero_de_serie = ? AND source = ? AND strftime('%Y-%m', derniere_mise_a_jour) = ?
                    ORDER BY derniere_mise_a_jour
                `;
            } else {
                query = `
                    SELECT
                        source, mono_a4, couleur_a4, total_mono, total_couleur, compteur_machine,
                        derniere_mise_a_jour
                    FROM kpax
                    WHERE numero_de_serie = ? AND source = ? AND strftime('%Y-%m', derniere_mise_a_jour) = ?
                    ORDER BY derniere_mise_a_jour
                `;
            }
    

            const compteursResult = db.exec(query, [numero_de_serie, source, dernierMoisManquantUtile]);
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

            if (compteurs.length === 0) {
                html += `⚠️ Aucun enregistrement trouvé pour ${numero_de_serie} en ${dernierMoisManquantUtile}.<br>`;
                continue;
            }

            // 10. Calculer la consommation pour ce mois
            let prevRow = null;
            let prevVolumes = { mono: 0, couleur: 0 };
            let statut = "Nouvelle";

            for (const row of compteurs) {
                const currentVolumes = calculerVolumes(constructeur, row);

                if (!prevRow) {
                    // Premier enregistrement du mois : on initialise
                    prevVolumes = currentVolumes;
                    prevRow = row;
                } else {
                    // Calculer la consommation pour ce mois
                    const volumeMono = currentVolumes.mono - prevVolumes.mono;
                    const volumeCouleur = currentVolumes.couleur - prevVolumes.couleur;
                    statut = volumeMono > 0 || volumeCouleur > 0 ? "Active" : "Éteinte";

                    // Insérer dans consommation
                    db.run(
                        `INSERT OR REPLACE INTO consommation
                        (source, numero_de_serie, constructeur, modele, annee, mois, volume_pages_mono, volume_pages_couleur, statut)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            source,
                            numero_de_serie,
                            constructeur,
                            modele,
                            annee,
                            moisNum,
                            volumeMono,
                            volumeCouleur,
                            statut
                        ]
                    );
                    rowsInserted++;
                    html += `✅ Insertion pour ${numero_de_serie} (${annee}-${moisNum.toString().padStart(2, '0')}) : mono=${volumeMono}, couleur=${volumeCouleur}, statut=${statut}.<br>`;
                }
            }
        }

        if (rowsInserted > 0) {
            html += `<br>${rowsInserted} enregistrements de consommation ajoutés pour le mois ${dernierMoisManquantUtile}.`;
            displayResults(html, 'Conso');
            exportDatabase(html, 'Conso');
        } else {
            displayResults("<p>✅ Aucun enregistrement à insérer.</p>", 'Conso');
        }

    } catch (err) {
        html += `<p class='error'>❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'Conso');
    }
}

// Fonction simplifiée pour traiter les mois manquants
function traiterDernierMoisManquant() {
    let html = '<h3>Traitement simplifié des mois manquants</h3><p>';
    let rowsInserted = 0;

    if (!db) {
        html = "<p class='error'>❌ Aucune base chargée.</p>";
        displayResults(html, 'Conso');
        return;
    }

    try {
        // 1. Récupérer tous les mois présents dans kpax
        const kpaxMoisResult = db.exec(`
            SELECT DISTINCT strftime('%Y-%m', derniere_mise_a_jour) AS annee_mois
            FROM kpax
            ORDER BY annee_mois
        `);

        const kpaxMois = [];
        if (kpaxMoisResult.length > 0) {
            for (const row of kpaxMoisResult[0].values) {
                kpaxMois.push(row[0]); // annee_mois
            }
        }

        // 2. Récupérer tous les mois présents dans consommation
        const consoMoisResult = db.exec(`
            SELECT DISTINCT printf('%04d-%02d', annee, mois) AS annee_mois
            FROM consommation
            ORDER BY annee_mois
        `);

        const consoMois = [];
        if (consoMoisResult.length > 0) {
            for (const row of consoMoisResult[0].values) {
                consoMois.push(row[0]); // annee_mois
            }
        }

        // 3. Trouver tous les mois manquants dans consommation
        const moisManquants = kpaxMois.filter(mois => !consoMois.includes(mois));

        // Ignorer si aucun mois manquant
        if (moisManquants.length === 0) {
            displayResults("<p>✅ Aucun mois manquant à traiter.</p>", 'Conso');
            return;
        }

        // 4. Récupérer le dernier mois de kpax
        const dernierMoisKpax = kpaxMois[kpaxMois.length - 1];

        // 5. Ignorer le dernier mois manquant s'il correspond au dernier mois de kpax (arrêté de compteur)
        const dernierMoisManquant = moisManquants[moisManquants.length - 1];
        if (dernierMoisManquant === dernierMoisKpax) {
            moisManquants.pop(); // Retirer le dernier mois manquant
        }

        // 6. Si aucun mois manquant utile, on affiche un message
        if (moisManquants.length === 0) {
            displayResults("<p>✅ Aucun mois manquant à traiter (le dernier mois est un arrêté de compteur).</p>", 'Conso');
            return;
        }

        html += `Traitement de ${moisManquants.length} mois manquants : <strong>${moisManquants.join(', ')}</strong>...<br>`;

        // 7. Traiter chaque mois manquant
        for (const mois of moisManquants) {
            const [annee, moisNum] = mois.split('-').map(Number);

            // 8. Récupérer les derniers compteurs du mois manquant pour toutes les machines
            const compteursActuelsResult = db.exec(`
                SELECT
                    numero_de_serie,
                    constructeur,
                    source,
                    modele,
                    ${getMaxVolumesQuery('actuel', 'kpax')}
                FROM kpax
                WHERE strftime('%Y-%m', derniere_mise_a_jour) = ?
                GROUP BY numero_de_serie, constructeur, source, modele
            `, [mois]);

            const compteursActuels = [];
            if (compteursActuelsResult.length > 0) {
                const columns = compteursActuelsResult[0].columns;
                for (const row of compteursActuelsResult[0].values) {
                    const obj = {};
                    for (let i = 0; i < columns.length; i++) {
                        obj[columns[i]] = row[i];
                    }
                    compteursActuels.push(obj);
                }
            }

            // 9. Récupérer les derniers compteurs du mois précédent pour toutes les machines
            const moisPrecedent = new Date(annee, moisNum - 1, 1);
            const anneePrecedente = moisPrecedent.getFullYear();
            const moisNumPrecedent = moisPrecedent.getMonth() + 1;
            const moisPrecedentStr = `${anneePrecedente}-${moisNumPrecedent.toString().padStart(2, '0')}`;

            const compteursPrecedentsResult = db.exec(`
                SELECT
                    numero_de_serie,
                    constructeur,
                    source,
                    modele,
                    ${getMaxVolumesQuery('precedent', 'kpax')}
                FROM kpax
                WHERE strftime('%Y-%m', derniere_mise_a_jour) = ?
                GROUP BY numero_de_serie, constructeur, source, modele
            `, [moisPrecedentStr]);

            const compteursPrecedents = [];
            if (compteursPrecedentsResult.length > 0) {
                const columns = compteursPrecedentsResult[0].columns;
                for (const row of compteursPrecedentsResult[0].values) {
                    const obj = {};
                    for (let i = 0; i < columns.length; i++) {
                        obj[columns[i]] = row[i];
                    }
                    compteursPrecedents.push(obj);
                }
            }

            // 10. Calculer et insérer la consommation pour chaque machine
            for (const actuel of compteursActuels) {
                const { numero_de_serie, constructeur, source, modele } = actuel;

                // Trouver le compteur précédent pour cette machine
                const precedent = compteursPrecedents.find(
                    c => c.numero_de_serie === numero_de_serie && c.source === source
                );

                // Calculer les volumes
                const volumeMono = (actuel.mono_max || 0) - (precedent ? precedent.mono_max || 0 : 0);
                const volumeCouleur = (actuel.couleur_max || 0) - (precedent ? precedent.couleur_max || 0 : 0);
                const statut = volumeMono > 0 || volumeCouleur > 0 ? "Active" : "Nouvelle";

                // Insérer dans consommation
                db.run(
                    `INSERT OR REPLACE INTO consommation
                    (source, numero_de_serie, constructeur, modele, annee, mois, volume_pages_mono, volume_pages_couleur, statut)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        source,
                        numero_de_serie,
                        constructeur,
                        modele,
                        annee,
                        moisNum,
                        volumeMono,
                        volumeCouleur,
                        statut
                    ]
                );
                rowsInserted++;
                html += `✅ Insertion pour ${numero_de_serie} (${annee}-${moisNum.toString().padStart(2, '0')}) : mono=${volumeMono}, couleur=${volumeCouleur}, statut=${statut}.<br>`;
            }
        }

        if (rowsInserted > 0) {
            html += `<br>${rowsInserted} enregistrements de consommation ajoutés pour les mois ${moisManquants.join(', ')}.`;
            displayResults(html, 'Conso');
            exportDatabase(html, 'Conso');
        } else {
            displayResults("<p>✅ Aucun enregistrement à insérer.</p>", 'Conso');
        }

    } catch (err) {
        html += `<p class='error'>❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'Conso');
        console.error("Erreur complète :", err);
    }

    // Fonction auxiliaire pour générer la requête de volumes max en fonction du constructeur
    function getMaxVolumesQuery(prefix, table) {
        switch (prefix) {
            case 'actuel':
            case 'precedent':
                return `
                    MAX(CASE WHEN constructeur = 'Brother' THEN
                        mono_recto_a4 + mono_r_v_a4 + 2 * (mono_recto_a3 + mono_r_v_a3)
                    ELSE 0 END) AS mono_max_brother,
                    MAX(CASE WHEN constructeur = 'Brother' THEN
                        couleur_recto_a4 + couleur_r_v_a4 + 2 * (couleur_recto_a3 + couleur_r_v_a3)
                    ELSE 0 END) AS couleur_max_brother,
                    MAX(CASE WHEN constructeur = 'Ricoh' AND source = 'EMS' THEN total_mono ELSE 0 END) AS mono_max_ricoh_ems,
                    MAX(CASE WHEN constructeur = 'Ricoh' AND source = 'École' THEN compteur_machine ELSE 0 END) AS mono_max_ricoh_ecole,
                    MAX(CASE WHEN constructeur = 'Ricoh' AND source = 'EMS' THEN total_couleur ELSE 0 END) AS couleur_max_ricoh_ems,
                    MAX(CASE WHEN constructeur = 'Lexmark' AND source = 'EMS' THEN mono_a4 ELSE 0 END) AS mono_max_lexmark_ems,
                    MAX(CASE WHEN constructeur = 'Lexmark' AND source = 'École' THEN total_mono ELSE 0 END) AS mono_max_lexmark_ecole,
                    MAX(CASE WHEN constructeur = 'Lexmark' AND source = 'EMS' THEN couleur_a4 ELSE 0 END) AS couleur_max_lexmark_ems,
                    MAX(CASE WHEN constructeur = 'Lexmark' AND source = 'École' THEN total_couleur ELSE 0 END) AS couleur_max_lexmark_ecole,
                    MAX(CASE WHEN constructeur NOT IN ('Brother', 'Ricoh', 'Lexmark') THEN compteur_mono ELSE 0 END) AS mono_max_default,
                    MAX(CASE WHEN constructeur NOT IN ('Brother', 'Ricoh', 'Lexmark') THEN compteur_couleur ELSE 0 END) AS couleur_max_default
                `;
            default:
                return '0 AS mono_max, 0 AS couleur_max';
        }
    }
}