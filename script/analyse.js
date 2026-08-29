

// =============================================
// FONCTION PRINCIPALE
// =============================================
function exportToCSV(tbl) {
  const table = document.getElementById(tbl);
  const rows = table.querySelectorAll("tr");
  let csvContent = "";

  // Parcourir chaque ligne du tableau
  rows.forEach((row) => {
    const rowData = [];
    const cells = row.querySelectorAll("td, th");

    cells.forEach((cell) => {
      // Échapper les guillemets et les virgules pour éviter les erreurs dans le CSV
      let cellText = cell.textContent.replace(/"/g, '""');
      rowData.push(`"${cellText}"`);
    });

    csvContent += rowData.join(",") + "\n";
  });

  // Créer un lien de téléchargement
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "tableau_export.csv");
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function PagesImprimees3() {
    try {
        if (!db) {
            html = "<p class='error'>❌ Aucune base chargée.</p>";
            displayResults(html, 'Analyse');
            return;
        }
        const deb_date = document.getElementById("date_deb").value;
        const fin_date = document.getElementById("date_fin").value;
        //console.debug(deb_date, fin_date);
        // Les calculs SCC sont dans la requête sql
        const query = `
            SELECT
                source,
                constructeur,
                modele,
                numero_de_serie,
                MIN(derniere_mise_a_jour) AS date_min,
                MAX(derniere_mise_a_jour) AS date_max,

                -- ✅ Différence entre MAX et MIN de l'expression pour Brother
                MAX(mono_recto_a4 + mono_r_v_a4 + 2 * (mono_recto_a3 + mono_r_v_a3)) -
                MIN(mono_recto_a4 + mono_r_v_a4 + 2 * (mono_recto_a3 + mono_r_v_a3)) AS brother_mono,

                MAX(couleur_recto_a4 + couleur_r_v_a4 + 2 * (couleur_recto_a3 + couleur_r_v_a3)) -
                MIN(couleur_recto_a4 + couleur_r_v_a4 + 2 * (couleur_recto_a3 + couleur_r_v_a3)) AS brother_couleur,

                -- Ricoh

                MAX(total_mono) - MIN(total_mono) as ricoh_mono_ems,
                MAX(compteur_machine) - MIN(compteur_machine) as ricoh_mono_ecole,
                MAX(total_couleur) - MIN(total_couleur) as ricoh_couleur_ems,
                
                -- Lexmark

                MAX(mono_a4) - MIN(mono_a4) as lexmark_mono_ems,
                MAX(total_mono) - MIN(total_mono) as lexmark_mono_ecole,
                MAX(couleur_a4) - MIN(couleur_a4) as lexmark_couleur_ems,
                MAX(total_couleur) - MIN(total_couleur) as lexmark_couleur_ecole
                
                
            FROM kpax
            WHERE derniere_mise_a_jour >= ? and substr(derniere_mise_a_jour, 1, 10) <= ?
            GROUP BY numero_de_serie
            ORDER BY source, constructeur, modele, numero_de_serie;
        ` ;

        // and derniere_mise_a_jour <= ? 

        const result = db.exec(query, [deb_date, fin_date]);

        if (result.length === 0) {
            html = "<p>Aucune donnée trouvée pour ces critères.</p>";
            displayResults(html, 'Analyse');
        } else {
            const { columns: headers, values: rows } = result[0];
            const idx = name => headers.indexOf(name);

            // Config par constructeur : nom des colonnes mono/couleur associées
            const constructeurs = {
                BROTHER: { mono_ems: idx('brother_mono'), couleur_ems: idx('brother_couleur') },
                RICOH:   { mono_ems: idx('ricoh_mono_ems'),   couleur_ems: idx('ricoh_couleur_ems'), 
                            mono_ecole: idx('ricoh_mono_ecole'), couleur_ecole: 0 },  
                LEXMARK: { mono_ems: idx('lexmark_mono_ems'), couleur_ems: idx('lexmark_couleur_ems'),
                            mono_ecole: idx('lexmark_mono_ecole'), couleur_ecole: idx('lexmark_couleur_ecole')}
                // ajouter d'autres constructeurs ici si besoin
            };

            const i = {
                source: idx('source'),
                constructeur: idx('constructeur'),
                modele: idx('modele'),
            };

            let html = `
                <h3>Différences par modèle :</h3>
                <p>
                <a href="#" id="exportLink" onclick="exportToCSV('tblres')">Exporter en CSV</a>
                <p>
                <table id="tblres" class="table table-bordered table-striped">
                <tr><th>${headers.join('</th><th>')}</th></tr>
            `;

            let pagesMono = 0, pagesCouleur = 0, modele = '', lastSource = '', lastConstructeur = '';

            const flushGroup = () => {
                if (modele !== '') {
                html += `<tr><td>${lastSource}</td><td>${lastConstructeur}</td><td>${modele}</td><td>${pagesMono}</td><td>${pagesCouleur}</td></tr>`;
                }
            };

            detail = document.getElementById("detailPages").checked;

            rows.forEach(row => {
                //html += `<tr><td>${row.map(val => val !== null ? val : 'NULL').join('</td><td>')}</td></tr>`;

                const constructeurNom = row[i.constructeur].toUpperCase();
                const cols = constructeurs[constructeurNom];

                if (cols) {
                    if (modele !== row[i.modele] || lastConstructeur.toUpperCase() !== constructeurNom) {
                        flushGroup(); // clôt le groupe précédent
                        if (row[0] == 'EMS') {
                            pagesMono = Number(row[cols.mono_ems]) || 0;
                            pagesCouleur = Number(row[cols.couleur_ems]) || 0;
                        } else {
                            pagesMono = Number(row[cols.mono_ecole]) || 0;
                            pagesCouleur = Number(row[cols.couleur_ecole]) || 0;
                        }
                        
                        modele = row[i.modele];
                    } else {
                        if (row[0] == 'EMS') {
                            pagesMono += Number(row[cols.mono_ems]) || 0;
                            pagesCouleur += Number(row[cols.couleur_ems]) || 0;
                        } else {
                            pagesMono += Number(row[cols.mono_ecole]) || 0;
                            pagesCouleur += Number(row[cols.couleur_ecole]) || 0;
                        }
                        
                    }
                    lastSource = row[i.source];
                    lastConstructeur = row[i.constructeur];
                } else {
                    html += `<tr><td colspan="${headers.length}">Constructeur non pris en charge : ${row[i.constructeur]}</td></tr>`;
                }
                
                // déplacé en fin pour ne pas intercaler la synthèse
                if (detail) {
                    html += `<tr><td>${row.map(val => val !== null ? val : 'NULL').join('</td><td>')}</td></tr>`;
                }
                
            });

            flushGroup(); // affiche le dernier groupe en cours

            html += '</table>';
            displayResults(html, 'Analyse');
            //document.getElementById('output').innerHTML = html;
            }
    } catch (err) {
        html += `<p class="error">❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'Analyse');
        console.error(err);
    }
    
}
