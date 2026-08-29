
// Fonction pour récupérer les données réelles (à adapter)
async function fetchConsommationData(startDate, endDate) {
  // Exemple : Requête vers ton backend ou SQLite
  // const response = await fetch(`/api/consommation?start=${startDate}&end=${endDate}`);
  // return await response.json();
    const deb_date = document.getElementById("date_debs").value;
    const fin_date = document.getElementById("date_fins").value;

    const query = `select source, annee, mois, sum(volume_pages_mono) as mono, sum(volume_pages_couleur) as couleur
                    from consommation
                    WHERE annee >= ? and mois >= ? and annee <= ? and mois <= ?
                    group by source, annee, mois
                    order by annee, mois, source`;

    try {
        if (!db) {
            html = "<p class='error'>❌ Aucune base chargée.</p>";
            displayResults(html, 'Stat');
            return;
        }

        const result = db.exec(query, [deb_date.slice(0, 4), deb_date.slice(5, 7), fin_date.slice(0, 4), fin_date.slice(5, 7)]);

        if (result.length === 0) {
            html = "<p>Aucune donnée trouvée pour ces critères.</p>";
            displayResults(html, 'Analyse');
        }
        console.log(result.length, deb_date.slice(0, 4), deb_date.slice(5, 7));
        const consos = [];
        if (result.length > 0) {
            const columns = result[0].columns;
            for (const row of result[0].values) {
                const obj = {};
                for (let i = 0; i < columns.length; i++) {
                    obj[columns[i]] = row[i];
                }
                consos.push(obj);
            }
        }
        
        html += `Trouvé ${consos.length} consommations dans la base de données entre ${deb_date} et ${fin_date}.<p>`;
        console.log(html);

        // Changer les objectifs pour l'année ou le mettre dans la base dans une table paramètre
        statsConso = {EMS : {data : [],
                            objectif : {
                                mono: 7834940,
                                couleur: 2464393
                            }},
                    Ecole : {data : [],
                            objectif : {
                                mono: 11814611,
                                couleur: 219902
                            }
                    }, 
        };
        for (const conso of consos) {
            const { source, annee, mois, mono, couleur } = conso;
            elt = {mois: annee + "-" + mois, mono: mono, couleur: couleur};
            console.log(source, annee, mois, mono, couleur);
            if (source == "EMS") {

                statsConso.EMS.data.push(elt);
            } else {
                statsConso.Ecole.data.push(elt);
            }
        }
        console.log(statsConso);

    } catch (err) {
        html += `<p class="error">❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'Stat');
        console.error(err);
    }
    return statsConso; // Remplace par tes données réelles
}

// Fonction pour créer un graphique mensuel
function createMonthlyChart(ctx, data, sourceName) {
  const mois = data.map(item => item.mois);
  const mono = data.map(item => item.mono);
  const couleur = data.map(item => item.couleur);

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: mois,
      datasets: [
        {
          label: 'Mono',
          data: mono,
          backgroundColor: 'rgb(160, 161, 162)',
          borderColor: 'rgb(113, 114, 115)',
          borderWidth: 1,
          yAxisID: 'y',
        },
        {
          label: 'Couleur',
          data: couleur,
          backgroundColor: 'rgba(75, 192, 192, 0.5)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Mono' },
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Couleur' },
          grid: { drawOnChartArea: false },
          min: 0,
          max: Math.max(...couleur) * 1.2, // Échelle adaptée à la couleur
        },
      },
      plugins: {
        title: { display: true, text: `Consommation mensuelle - ${sourceName}` },
      },
    },
  });
}

// Fonction pour créer un graphique cumulatif avec objectif
function createCumulativeChart(ctx, data, sourceName, objectifs) {
  const mois = data.map(item => item.mois);
  const monoCumul = [];
  const couleurCumul = [];
  let cumulMono = 0;
  let cumulCouleur = 0;

  // Calcule les cumulatifs
  data.forEach(item => {
    cumulMono += item.mono;
    cumulCouleur += item.couleur;
    monoCumul.push(cumulMono);
    couleurCumul.push(cumulCouleur);
  });


  // Calcule les objectifs mensuels cumulés
  const objectifMensuelMono = objectifs.mono / 12;
  const objectifMensuelCouleur = objectifs.couleur / 12;
  const objectifCumulMono = mois.map((_, i) => objectifMensuelMono * (i + 1));
  const objectifCumulCouleur = mois.map((_, i) => objectifMensuelCouleur * (i + 1));

  const maxCouleur = Math.max(...couleurCumul, ...objectifCumulCouleur) *1.4;
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: mois,
      datasets: [
        {
          label: 'Cumul Mono',
          data: monoCumul,
          borderColor: 'rgb(159, 160, 161)',
          backgroundColor: 'rgba(54, 162, 235, 0.1)',
          tension: 0.1,
          yAxisID : 'y'
        },
        {
          label: 'Cumul Couleur',
          data: couleurCumul,
          borderColor: 'rgba(75, 192, 192, 1)',
          backgroundColor: 'rgba(75, 192, 192, 0.1)',
          tension: 0.1,
          yAxisID : 'y1'
        },
        {
          label: 'Objectif Mono',
          data: objectifCumulMono,
          borderColor: 'rgba(255, 99, 132, 1)',
          borderDash: [5, 5],
          backgroundColor: 'rgba(255, 99, 132, 0.1)',
          tension: 0.1,
          yAxisID : 'y'
        },
        {
          label: 'Objectif Couleur',
          data: objectifCumulCouleur,
          borderColor: 'rgba(255, 159, 64, 1)',
          borderDash: [5, 5],
          backgroundColor: 'rgba(255, 159, 64, 0.1)',
          tension: 0.1,
          yAxisID : 'y1'
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: `Cumul de consommation - ${sourceName} (Objectif Mono: ${objectifs.mono}, Objectif Couleur: ${objectifs.couleur})`,
        },
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: {
            display: true,
            text: 'Mono',
          },
          beginAtZero: true,
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'Couleur',
          },
          grid: {
            drawOnChartArea: false, // Évite de superposer les grilles
          },
          beginAtZero: true,
          max: maxCouleur,
        },
      }
    },
  });
}

// Fonction pour afficher les graphiques
async function afficheStats(startDate, endDate) {
  const data = await fetchConsommationData(startDate, endDate);
  const container = document.getElementById('charts-container');
  container.innerHTML = ''; // Efface les graphiques précédents

  for (const [source, sourceInfo] of Object.entries(data)) {
    const sourceDiv = document.createElement('div');
    sourceDiv.className = 'source-charts';
    sourceDiv.innerHTML = `<h3>${source}</h3>`;
    container.appendChild(sourceDiv);

    const monthlyCanvas = document.createElement('canvas');
    monthlyCanvas.id = `monthly-chart-${source}`;
    sourceDiv.appendChild(monthlyCanvas);

    const cumulativeCanvas = document.createElement('canvas');
    cumulativeCanvas.id = `cumulative-chart-${source}`;
    sourceDiv.appendChild(cumulativeCanvas);

    // Passe les données et les objectifs spécifiques
    createMonthlyChart(monthlyCanvas, sourceInfo.data, source);
    createCumulativeChart(cumulativeCanvas, sourceInfo.data, source, sourceInfo.objectif);
  }
}
