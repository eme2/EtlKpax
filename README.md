# EtlKpax

Suivi des compteurs d'impression (exports Kpax mensuels SCC et EMC-Konica) :

1. **vérifier la facturation** des fournisseurs (trimestrielle pour SCC) ;
2. **corriger** ses données quand c'est justifié, avec traçabilité ;
3. **suivre le budget annuel** en pages et en montant moyen.

L'application est une simple page web : ouvrir `index.html` dans Chrome, Edge ou Firefox.
Une connexion Internet est nécessaire au chargement (bibliothèques), mais **aucune donnée ne quitte le poste**.

## Utilisation mensuelle

1. **Importer Kpax** : glisser tous les exports du mois (ECOLE, EMS, EMC). Source, fournisseur et mois
   sont détectés depuis le nom du fichier et peuvent être corrigés avant l'import.
   Réimporter un même mois remplace les relevés (pas de doublon).
   Export EMC : la source est lue ligne par ligne dans la colonne **Nom agent**
   (« Eurométropole de Strasbourg » → EMS, « EMS Ecoles » → ECOLE) ; à défaut, elle est choisie pour tout le fichier.
2. La consommation est recalculée et la base enregistrée **automatiquement dans le navigateur**.
3. **À vérifier** : nouvelles machines, relevés manquants, compteurs en baisse, machines déplacées ou absentes.
4. Bouton **Copie de sauvegarde** (en haut à droite) : télécharger régulièrement la base `.sqlite`.

## Vérifier une facture

Menu **Facturation** : choisir le fournisseur et le trimestre, puis importer l'annexe détaillée de la facture
(CSV ou Excel, une ligne par machine). On indique une fois quelles colonnes contiennent le n° de série,
les volumes mono/couleur (et éventuellement les index de fin et le montant). Ce choix est mémorisé.
Chaque machine est classée OK / Écart / Non facturée / Hors Kpax. Un écart est signalé s'il dépasse à la fois
un nombre de pages et un pourcentage du volume calculé (par défaut 20 pages et 2 %). Ces seuils se règlent par
fournisseur dans l'écran de comparaison et sont enregistrés immédiatement dans la base.

> La consommation d'un mois se calcule avec le relevé du mois suivant :
> pour le T1 (janvier → mars), il faut le relevé d'avril.

**Facture SCC** (classeur Excel trimestriel) : l'onglet « RAPPORT Période » est choisi automatiquement et ses
colonnes reconnues (`S/N`, `Conso A4/A3 N&B`, `Conso A4/A3 COULEUR`, `Relevé A4/A3`, `TOTAL COUT PAGE`,
`Statut PARC`, `COMMENTAIRE`). Les volumes sont comparés en **équivalent A4** : SCC facture une page A3 au prix de
deux A4. Les petits écarts viennent surtout de la date des index (30/09 chez SCC, 01/10 dans Kpax) et se
compensent d'un trimestre à l'autre. SCC facture une machine neuve à partir d'un compteur 0, comme l'application.

## Corrections

Menu **Machines & corrections** : une correction **remplace le compteur cumulé** d'une machine pour un relevé
donné (ou ajoute un relevé manquant). Les données Kpax d'origine ne sont jamais modifiées ; supprimer la correction
rétablit le calcul initial. Un motif est obligatoire.

Cas typiques : aligner un index sur celui de la facture, saisir le compteur de départ d'une machine
qui n'était pas neuve, remplacer un relevé à 0.

## Règles de calcul

- Les règles de lecture des compteurs (quel compteur Kpax utiliser selon fournisseur / constructeur / source)
  sont regroupées dans `script/regles.js`. **EMC-Konica utilise pour l'instant la règle par défaut**
  (`total_mono` / `total_couleur`), à confirmer à réception de la première facture.
- Dans le premier import d'un lot (fournisseur + source), le relevé sert de point de départ, sans consommation.
- Une machine qui apparaît plus tard est « Nouvelle » : tout son compteur est compté le mois précédent.
- Compteur vide ou à 0 : on reporte la dernière valeur ; la consommation est rattrapée au relevé suivant.
- Compteur en baisse : volume mis à 0 et signalé.

## Confidentialité

Le `.gitignore` exclut les bases (`*.sqlite`, `*.db`), les exports (`*.csv`), les factures (`*.xlsx`, `*.pdf`)
et les dossiers `bdd/` et `donnees/`. Ne jamais forcer leur ajout au dépôt.

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | page de l'application |
| `script/db.js` | base SQLite, structure, sauvegarde navigateur |
| `script/regles.js` | règles de lecture des compteurs par fournisseur / constructeur |
| `script/conso.js` | calcul de la consommation mensuelle |
| `script/import.js` | import des exports Kpax |
| `script/facturation.js` | comparaison avec les factures |
| `script/budget.js` | objectifs annuels et graphiques |
| `script/machines.js` | historique machine et corrections |
| `script/vues.js` | tableau de bord, consommation, à vérifier, base |
