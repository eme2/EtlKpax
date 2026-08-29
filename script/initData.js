function loadDropdown() {
    if (!db) return;
    const dd_data = db.exec(`select DISTINCT substr(derniere_mise_a_jour, 1, 10) as dt_maj FROM kpax 
                            WHERE substr(derniere_mise_a_jour, 9,2) = '01'
                            ORDER by derniere_mise_a_jour desc;`);
    if (dd_data.length === 0) {
        html = "<p>Aucune date dans la base.</p>";
        displayResults(html, 'Analyse');
        return;
    }
    const d_deb = document.getElementById("date_deb");
    const d_fin = document.getElementById("date_fin");
    const d_debs = document.getElementById("date_debs");
    const d_fins = document.getElementById("date_fins");    //console.log(dd_data[0].values)
    dd_data[0].values.forEach((item)=> {
        const optiond = document.createElement("option");
        const optionf = document.createElement("option");
        const optionds = document.createElement("option");
        const optionfs = document.createElement("option");
        optiond.value = item[0];
        optionf.value = item[0];
        optionds.value = item[0];
        optionfs.value = item[0];
        optiond.textContent = item[0];
        optionf.textContent = item[0];
        optionds.textContent = item[0];
        optionfs.textContent = item[0];
        d_deb.appendChild(optiond);
        d_fin.appendChild(optionf);
        d_debs.appendChild(optionds);
        d_fins.appendChild(optionfs);
    });
}

function loadModeles() {
    if (!db) return;
    const dd_data = db.exec(`select DISTINCT constructeur, modele
                            FROM kpax
                            ORDER by constructeur, modele;`);
    if (dd_data.length === 0) {
        html = "<p>Aucun modele dans la base.</p>";
        displayResults(html, 'Analyse');
        return;
    }
    const d_modele = document.getElementById("d_modele");
    
    dd_data[0].values.forEach((item)=> {
        const option = document.createElement("option");
        option.value = item;
        option.textContent = `${item[0]} - ${item[1]}`;
        d_modele.appendChild(option);
    });
}


// Recherche du détail d'un modèle
function groupModele() {
    try {
        // récupération du modèle
        const mod = document.getElementById("d_modele").value.split(',')[1];
        const date_deb = document.getElementById("date_deb").value
        // 1. Vérifie que le modèle est saisi
        if (!mod) {
            html = "<p class='error'>❌ Veuillez saisir un modèle.</p>";
            displayResults(html, 'Analyse');
            return;
        }

        // 2. Utilise des PARAMÈTRES pour éviter l'injection SQL
        //    (SQL.js supporte les paramètres avec "?" comme SQLite)
        const result = db.exec(
            `SELECT
                source,
                constructeur,
                modele,
                numero_de_serie,
                derniere_mise_a_jour,
                compteur_machine,
                total_mono,
                total_couleur,
                mono_a4,
                couleur_a4,
                mono_recto_a4,
                mono_r_v_a4,
                mono_recto_a3,
                mono_r_v_a3,
                couleur_recto_a4,
                couleur_r_v_a4,
                couleur_recto_a3,
                couleur_r_v_a3
            FROM kpax
            WHERE modele = ?
            AND derniere_mise_a_jour > ?
            ORDER BY numero_de_serie, derniere_mise_a_jour DESC`,
            [mod, date_deb]  // Paramètres dans l'ordre des "?"
        );

        // 3. Vérifie que la requête a retourné des résultats
        if (!result || result.length === 0 || !result[0] || !result[0].columns) {
            html = "<p>Aucune donnée trouvée pour ce modèle.</p>";
            displayResults(html, 'Analyse');
            return;
        }

        // 4. Traite les résultats (exemple : affiche un tableau)
        const headers = result[0].columns;
        const rows = result[0].values;
        html = `<table table-bordered table-striped><tr><th>${headers.join('</th><th>')}</th></tr>`;
        rows.forEach(row => {
            html += `<tr><td>${row.join('</td><td>')}</td></tr>`;
        });
        html += '</table>';
        displayResults(html, 'Analyse');

    } catch (err) {
        html += `<p class="error">❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'Analyse');
        console.error("Erreur SQL :", err);
    }
}

function loadKPI() {
    if (!db) return;
    const kpi_data = db.exec(`WITH dernier_mois AS (
                                SELECT MAX(dateCompteurs) AS max_date FROM kpax
                                )
                                SELECT
                                    (SELECT max_date FROM dernier_mois) AS dernier_mois,
									(select  strftime("%Y-%m",date(max_date || '-01', '-1 month')) from dernier_mois ) AS mois_precedent`);
    if (kpi_data.length === 0) {
        html = "<p>Aucune date dans la base.</p>";
        displayResults(html, 'Analyse');
        return;
    }

    // 3. Vérifie que la requête a retourné des résultats
    if (!kpi_data ||   kpi_data.length === 0 || !kpi_data[0] || !kpi_data[0].columns) {
        html = "<p>Aucune donnée kpax pour la date de dernière mise à jour</p>";
        displayResults(html, 'Analyse');
        return;
    }

    // 4. Traite les résultats (exemple : affiche un tableau)
    const headers = kpi_data[0].columns;
    const rows = kpi_data[0].values;
    const der_date = rows[0][0];
    const prec_date = rows[0][1];
    

    const vol_machine = db.exec(`select source, constructeur, dateCompteurs as dt_vol, count(distinct numero_de_serie) 
                        from kpax 
                        where dateCompteurs = ? or dateCompteurs = ? 
                        group by source, constructeur, dt_vol;`,[der_date, prec_date]);
    
    // remplissage du kpi
    if (vol_machine) {
        let i_ecole = 0, i_ems = 0;
        let c_ecole = 0, c_ems = 0;
        let di_ecole = 0, di_ems = 0;
        let dc_ecole = 0, dc_ems = 0;
        const h_machine = vol_machine[0].columns;
        const v_machine = vol_machine[0].values;
        // calcul des indicateurs
        for (row of v_machine) {
            if (row[0] == 'ECOLE') {
                if (row[1] == 'Ricoh') {
                    if (row[2] == der_date) {
                        c_ecole += row[3];
                        dc_ecole += row[3];
                    } else { // date précédente
                        dc_ecole -= row[3];
                    }
                } else {    // Imprimantes
                   if (row[2] == der_date) {
                        i_ecole += row[3];
                        di_ecole += row[3];
                    } else { // date précédente
                        di_ecole -= row[3];
                    }
                }
            } else {    // EMS
                if (row[1] == 'Ricoh') {
                    if (row[2] == der_date) {
                        c_ems += row[3];
                        dc_ems += row[3];
                    } else { // date précédente
                        dc_ems -= row[3];
                    }
                } else {    // Imprimantes
                   if (row[2] == der_date) {
                        i_ems += row[3];
                        di_ems += row[3];
                    } else { // date précédente
                        di_ems -= row[3];
                    }
                }

            } 
        }  // fin du for row of v_machine
        
        const maDate = new Date(der_date + "-01"); // Ajoute le jour pour éviter les problèmes de parsing

        // Options pour formater la date
        const options = { month: 'long', year: 'numeric' };
        let kpi = maDate.toLocaleString('fr-FR', options).replace(/^./, (str) => str.toUpperCase());

        //kpi = `${strftime('%mmm %Y', der_date)}`;
        document.getElementById('kpidt1').innerHTML = kpi;
        kpi = `Ecole ${i_ecole} (Δ:${di_ecole}) EMS ${i_ems} (Δ:${di_ems})`;
        document.getElementById('kpax-imprimantes').innerHTML = kpi;
        kpi = `Ecole ${c_ecole} (Δ:${dc_ecole}) EMS ${c_ems} (Δ:${dc_ems})`;
        document.getElementById('kpax-copieurs').innerHTML = kpi;
    }

    // KPI 2 : pages imprimées dernier mois
    document.getElementById('kpidt2')
}
