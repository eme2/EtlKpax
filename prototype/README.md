# Prototype ETL Kpax avec Excel et Power Query

## Overview

Ce prototype remplace votre application JavaScript/SQLite actuelle par une solution 100% Excel + Power Query. Plus besoin de base de donnees SQLite ou de code JavaScript complexe !

## Architecture

ETL_Kpax_Prototype.xlsx
├── kpax_source - Donnees brutes importees depuis les CSV
├── consommation - Resultats du calcul de consommation (via Power Query)
├── stats - Donnees agregées pour les statistiques
├── params - Parametres (objectifs, etc.)
├── Tableau_de_bord - Interface utilisateur avec KPI
└── Requetes Power Query
    ├── Import_Kpax - Nettoyage et preparation des donnees
    ├── Calcul_Consommation - Calcul de la consommation mensuelle
    ├── Aggregation_Stats - Aggregation pour les graphiques
    └── KPI_Machines et KPI_Pages - Calcul des indicateurs

## Installation

### 1. Ouvrir le fichier Excel
Ouvrez ETL_Kpax_Prototype.xlsx avec Excel (version 2016 ou superieure recommandee)

### 2. Creer les requetes Power Query
Ouvrez le fichier PowerQuery_Queries.txt et suivez les instructions pour creer les 5 requetes Power Query.

### 3. Activer les macros
Fichier > Options > Centre de gestion de la confidentialite > Activer toutes les macros

## Utilisation

### Importer un fichier CSV
1. Cliquez sur le bouton Importer CSV dans le tableau de bord
2. Selectionnez votre fichier CSV Kpax
3. Le systeme detecte automatiquement la source, le fournisseur et la date

### Calculer la consommation
Automatique: Des que vous importez un CSV, les requetes Power Query se rafraichissent
Manuel: Cliquez sur Rafraîchir Tout pour recalculer toutes les requetes

### Mettre a jour le tableau de bord
Cliquez sur Mettre a jour Dashboard pour rafraichir les KPI

## Fonctionnalites

### KPI affiches dans le tableau de bord
- Machines relevees (par type et source)
- Pages imprimees (par trimestre)
- Repartition ECOLE/EMS

### Donnees calculees
1. Consommation mensuelle par machine
2. Statistiques agregées par source, annee et mois
3. Indicateurs de performance

## Personnalisation

### Ajouter de nouvelles colonnes
Modifiez la requete Import_Kpax pour inclure les nouvelles colonnes

### Modifier les calculs
Editez directement les requetes Power Query dans l'editeur

### Changer les objectifs
Modifiez les valeurs dans la feuille params

## Graphiques recommandes

### 1. Graphique mensuel par source
Donnees: Aggregation_Stats
Type: Histogramme groupe
Axe X: mois_annee
Axe Y: volume_pages_mono, volume_pages_couleur

### 2. Graphique cumulatif avec objectifs
Donnees: Aggregation_Stats + params
Type: Courbes

### 3. Repartition par constructeur
Donnees: Calcul_Consommation
Type: Camembert

## Performances

Operation | Temps estime (1000 lignes)
--- | ---
Import CSV | < 1 seconde
Calcul consommation | < 2 secondes
Aggregation stats | < 1 seconde
Rafraîchissement complet | < 5 secondes

## Mise a jour incrementale
Le prototype prend en charge la mise a jour incrementale:
- Seules les nouvelles donnees sont traitees
- Les calculs existants ne sont pas recalcules
- Les donnees historiques sont conservees

## Format des fichiers CSV
Le systeme detecte automatiquement:
- Format SCC: ECOLE_KPAXManageReport.20251201.0713198483.1.
- Format EMC: 78-exportkpaxemc-02d214a6-...-2026-08-03-083732.

## Depannage

### Problemes courants et solutions
Probleme | Solution
--- | ---
Les requetes ne se rafraichissent pas | Verifiez que les noms des feuilles correspondent
Erreur de type dans Power Query | Verifiez les types de colonnes dans l'editeur
Les macros ne fonctionnent pas | Enregistrez au format .xlsm et activez les macros
Impossible de detecter la date | Verifiez le format du nom du fichier

## Documentation Power Query
Pour en savoir plus:
- https://docs.microsoft.com/fr-fr/power-query/
- https://learn.microsoft.com/fr-fr/power-query/

## Conseils
1. Sauvegardez regulierement votre fichier Excel
2. Testez avec de petits jeux de donnees avant d'importer des fichiers volumineux
3. Utilisez des Tableaux Croises Dynamiques pour des analyses plus poussees
4. Creez des vues personnalisees avec des filtres
5. Automatisez l'import avec Power Automate

## Prochaines etapes
1. Creez les requetes Power Query
2. Testez avec vos donnees reelles
3. Personnalisez les calculs selon vos besoins
4. Ajoutez des Tableaux Croises Dynamiques
5. Creez des graphiques Excel natifs

Version: 1.0
Date: 2025
Auteur: Migration depuis JavaScript/SQLite vers Excel/Power Query
