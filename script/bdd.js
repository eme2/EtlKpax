let db;
let SQL;
let sourceColumnName = "source";
let fournisseurColumnName = "fournisseur";
let dateCompteursColumnName = "dateCompteurs" 
let SQLReady = false;

// Mapping personnalisé pour forcer des types sur certaines colonnes
const TYPE_MAPPING = {
    'derniere_mise_a_jour': 'DATE',
    'cree_le': 'DATE',
    'date': 'DATE',
    'date_creation': 'DATE',
    'date_modification': 'DATE',
    'total_mono': 'INTEGER',
    'total': 'INTEGER',
    'montant': 'REAL',
    'prix': 'REAL',
    'id': 'INTEGER PRIMARY KEY AUTOINCREMENT',
    'source': 'TEXT',
    'fournisseur': 'TEXT',
    'dateCompteurs' : 'TEXT'
};
let html = '';

// Initialisation de SQL.js
async function initSQL() {
    if (SQL) return SQL;
    SQL = await initSqlJs({
        locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
    });
    SQLReady = true;
    return SQL;
}

// Charge une base SQLite depuis un fichier
async function loadDatabase() {
    const fileInput = document.getElementById('sqliteFile');
    const file = fileInput.files[0];

    if (!SQLReady) {
        console.log("SQL.js n'est pas prêt"); // Log 2
        return;
    }
    
    if (!file) {
        alert("Veuillez sélectionner un fichier SQLite.");
        return;
    }
    displayResults(`<p>Chargement en cours...</p>`, 'loadDB');

    try {
        await initSQL();
        
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const arrayBuffer = e.target.result;
                db = new SQL.Database(new Uint8Array(arrayBuffer));
                html = `<p class="success">✅ Base SQLite "${file.name}" chargée avec succès.</p>`;
                listTables();
                loadDropdown();
                loadModeles();
                loadKPI();
                displayResults(html, 'loadDB');
            } catch (err) {
                displayResults(`<p class="error">❌ Erreur lors du chargement de la base : ${err.message}</p>`, 'loadDB');
            }
        };
        reader.readAsArrayBuffer(file);
                
    } catch (err) {
        html += `<p class="error">❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'loadDB');
    }
}

// Liste les tables de la base
function listTables() {
    if (!db) return;
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    if (tables.length === 0) {
        document.getElementById('output').innerHTML += "<p>Aucune table dans la base.</p>";
        return;
    }
    html += "<p><strong>Tables existantes :</strong> ";
    html += tables[0].values.map(t => t[0]).join(", ");
    html += "</p>";
    //document.getElementById('output').innerHTML += html;
}

// Nettoie les noms de colonnes
function cleanHeaderName(name) {
    return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\s\W-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
}

// Extrait le préfixe (ECOLE ou EMS) du nom de fichier
function getSourcePrefix(fileName) {
    const upperName = fileName.toUpperCase();
    if (upperName.startsWith("ECOLE")) return "ECOLE";
    if (upperName.startsWith("EMS")) return "EMS";
    if (upperName.includes("ECOLE")) return "ECOLE";
    if (upperName.includes("EMS")) return "EMS";
    return null;
}

function getFour(fileName) {
    const upperName = fileName.toUpperCase();
    if (upperName.includes("EMC")) return "EMC";
    return "SCC";
}

function getDateCompteurs(fileName, fournisseur) {
    if (fournisseur == 'SCC') {
        const regex = /(\d{4})(\d{2})/; // Capture 4 chiffres (année) suivis de 2 chiffres (mois)
        const match = fileName.match(regex);

        if (match) {
            const annee = match[1]; 
            const mois = match[2];  
            return `${annee}-${mois}`; 
        }
    }
    if (fournisseur == 'EMC') {
        const parties = fileName.split('-');
        return parties[7] + '-' + parties[8]; 
    }
    return null;
    // ECOLE_KPAXManageReport.20251201.0713198483.1. (SCC)
    // 78-exportkpaxemc-02d214a6-f238-4130-9e9e-cae553560328-2026-08-03-083732. (EMC)
}

function initDateCompteurs(fileName) {
    const fournisseur = getFour(fileName.name);
    const dtCpt = getDateCompteurs(fileName.name, fournisseur);
    console.log("initialisation de la date selon nom du fichier : ", dtCpt);
    document.getElementById('cptName').value = dtCpt;
    
}

// Détecte le type SQL d'une valeur (en string)
function detectType(value) {
    if (value === null || value === undefined || value === '') return 'TEXT';

    // Vérifie si c'est un entier
    if (/^-?\d+$/.test(value)) return 'INTEGER';

    // Vérifie si c'est un nombre décimal
    if (/^-?\d+\.\d+$/.test(value)) return 'REAL';

    // Vérifie si c'est une date (format YYYY-MM-DD ou DD/MM/YYYY ou DD-MM-YYYY)
    if (/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        /^\d{2}\/\d{2}\/\d{4}$/.test(value) ||
        /^\d{2}-\d{2}-\d{4}$/.test(value)) {
        return 'DATE';
    }

    return 'TEXT';
}

// Détermine le type SQL d'une colonne en analysant ses valeurs
function detectColumnType(columnName, values) {
    // Vérifie d'abord le mapping personnalisé
    if (TYPE_MAPPING[columnName]) {
        return TYPE_MAPPING[columnName];
    }

    // Force INTEGER pour les colonnes commençant par "total_"
    if (columnName.startsWith('total_') || columnName.includes('a3')|| columnName.includes('a4')|| columnName.startsWith('copie') || columnName.startsWith('impression') || columnName.startsWith('mono') || columnName.startsWith('couleur')) {
        return 'INTEGER';
    }
    // Compte les types détectés pour chaque valeur
    const typeCounts = {
        INTEGER: 0,
        REAL: 0,
        DATE: 0,
        TEXT: 0
    };

    values.forEach(value => {
        // Convertit en string si ce n'est pas déjà le cas (à cause de dynamicTyping)
        const strValue = value !== null && value !== undefined ? String(value) : '';
        const type = detectType(strValue);
        typeCounts[type]++;
    });

    // Détermine le type dominant
    if (typeCounts.INTEGER === values.length) return 'INTEGER';
    if (typeCounts.REAL + typeCounts.INTEGER === values.length) return 'REAL';
    if (typeCounts.DATE === values.length) return 'DATE';

    return 'TEXT';
}

// Traite le fichier CSV
async function processCSV() {
    const fileInput = document.getElementById('csvFile');
    const file = fileInput.files[0];
    const tableName = document.getElementById('tableName').value.trim();
    const appendData = document.getElementById('appendData').checked;
    let four = 'Inconnu';

    if (!file) {
        alert("Veuillez sélectionner un fichier CSV.");
        return;
    }
    if (!tableName) {
        alert("Veuillez indiquer un nom de table.");
        return;
    }

    try {
        await initSQL();
        if (!db) {
            db = new SQL.Database();
        }

        const sourcePrefix = getSourcePrefix(file.name);
        four = getFour(file.name);
        const dtCompteurs = getDateCompteurs(file.name, four);
        if (!dtCompteurs) {
            displayResults(`<p class="error">❌ le format de la date des compteurs est erroné</p>`, 'loadDB');
            return;
        }

        Papa.parse(file, {
            encoding: "ISO-8859-1",
            header: true,
            transformHeader: (header) => cleanHeaderName(header),
            dynamicTyping: false, // Désactivé pour analyser nous-mêmes les types
            complete: function(results) {
                const data = results.data;
                let columns = results.meta.fields;

                // Ajoute les colonnes supplémentaires si nécessaire
                if (sourcePrefix && !columns.includes(sourceColumnName)) {
                    columns = [sourceColumnName, fournisseurColumnName, dateCompteursColumnName, ...columns];
                    data.forEach(row => {
                        row[sourceColumnName] = sourcePrefix;
                        row[fournisseurColumnName] = four;
                        row[dateCompteursColumnName] = dtCompteurs;
                    });
                }

                // Détecte les types pour chaque colonne
                const columnTypes = {};
                columns.forEach(col => {
                    const values = data.map(row => row[col]);
                    columnTypes[col] = detectColumnType(col, values);
                });

                addDataToTable(tableName, columns, columnTypes, data, appendData);
            },
            error: function(err) {
                html += `<p class="error">❌ Erreur lors de la lecture du CSV : ${err.message}</p>`;
                displayResults(html, 'loadCSV');
            }
        });
    } catch (err) {
        html += `<p class="error">❌ Erreur : ${err.message}</p>`;
        displayResults(html, 'loadCSV');
    }
}

// Ajoute ou crée une table avec les types détectés
function addDataToTable(tableName, columns, columnTypes, data, appendData) {
    try {
        // Vérifie si la table existe
        const tableExists = db.exec(`
            SELECT name FROM sqlite_master
            WHERE type='table' AND name=?
        `, [tableName]).length > 0;

        if (!tableExists) {
            // Crée la table avec les types détectés
            const columnsSql = columns.map(col => {
                if (columnTypes[col].includes('PRIMARY KEY')) {
                    return `${col} ${columnTypes[col]}`;
                }
                return `${col} ${columnTypes[col]}`;
            }).join(', ');

            db.run(`CREATE TABLE ${tableName} (${columnsSql})`);
            //document.getElementById('output').innerHTML +=
            //    `<p class="success">✅ Table "${tableName}" créée.</p>
            //     <div class="type-info"><strong>Types des colonnes :</strong><br>
            //     ${columns.map(col => `${col}: ${columnTypes[col]}`).join('<br>')}</div>`;
        } else {
            // Vérifie que les colonnes existent (sinon les ajoute)
            const existingColumns = db.exec(`
                PRAGMA table_info(${tableName})
            `)[0].values.map(row => ({
                name: row[1],
                type: row[2]
            }));

            const missingColumns = columns.filter(col => {
                return !existingColumns.some(existing => existing.name === col);
            });

            if (missingColumns.length > 0) {
                missingColumns.forEach(col => {
                    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${col} ${columnTypes[col]}`);
                });
                document.getElementById('output').innerHTML +=
                    `<p class="success">✅ Colonnes manquantes ajoutées à "${tableName}": ${missingColumns.join(", ")}</p>`;
            }
        }

        // Insère les données
        const placeholders = columns.map(() => '?').join(', ');
        const insertStmt = db.prepare(`
            INSERT INTO ${tableName} (${columns.join(', ')})
            VALUES (${placeholders})
        `);

        let insertedRows = 0;
        data.forEach(row => {
            const values = columns.map(col => row[col] !== undefined ? row[col] : null);
            insertStmt.run(values);
            insertedRows++;
        });

        document.getElementById('output').innerHTML +=
            `<p class="success">✅ ${insertedRows} lignes ${appendData ? 'ajoutées' : 'importées'} dans "${tableName}".</p>`;

        // Affiche un aperçu
        showTablePreview(tableName);

        // Propose de télécharger la base
        exportDatabase('', 'loadCSV');

    } catch (err) {
        document.getElementById('output').innerHTML +=
            `<p class="error">❌ Erreur : ${err.message}</p>`;
        console.error(err);
    }
}

// Affiche un aperçu de la table
function showTablePreview(tableName) {
    const result = db.exec(`SELECT * FROM ${tableName} LIMIT 5`);
    if (result.length === 0) return;

    const headers = result[0].columns;
    const rows = result[0].values;
    let html = `<h3>Aperçu de "${tableName}" (5 premières lignes) :</h3><table><tr><th>${headers.join('</th><th>')}</th></tr>`;
    rows.forEach(row => {
        html += `<tr><td>${row.map(val => val !== null ? val : 'NULL').join('</td><td>')}</td></tr>`;
    });
    html += '</table>';
    displayResults(html, 'loadCSV');
    document.getElementById('output').innerHTML += html;
}

// Exporte la base pour téléchargement
function exportDatabase(txt, cible) {
    if (!db) return;
    
    const binaryArray = db.export();
    const blob = new Blob([binaryArray], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const dt = new Date().toLocaleString('fr-FR');
    displayResults(`à ${dt} <br>${txt}<p><a href="${url}" download="database.sqlite">💾 Télécharger la base SQLite</a></p>`, cible);
    //document.getElementById('output').innerHTML +=
    //    `<p><a href="${url}" download="database.sqlite">💾 Télécharger la base SQLite</a></p>`;
}


// Initialise SQL.js au chargement
initSQL().then(() => {
    document.getElementById('output').innerHTML = "<p>SQL.js prêt. Chargez une base ou importez un CSV.</p>";
});

function checkDB(myDB, section) {
    if (!myDB) {
        const html = "<p class='error'>❌ Aucune base chargée.</p>";
        displayResults(html, section);
        return false;
    }
    return true;
}