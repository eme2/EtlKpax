Attribute VB_Name = "Module1"
Option Explicit

Public Const SOURCE_SHEET As String = "kpax_source"
Public Const CONSO_SHEET As String = "consommation"
Public Const STATS_SHEET As String = "stats"
Public Const PARAMS_SHEET As String = "params"
Public Const DASHBOARD_SHEET As String = "Tableau_de_bord"

Function GetSourcePrefix(fileName As String) As String
    Dim upperName As String
    upperName = UCase(fileName)
    If InStr(upperName, "ECOLE") > 0 Then
        GetSourcePrefix = "ECOLE"
    ElseIf InStr(upperName, "EMS") > 0 Then
        GetSourcePrefix = "EMS"
    Else
        GetSourcePrefix = ""
    End If
End Function

Function GetFour(fileName As String) As String
    Dim upperName As String
    upperName = UCase(fileName)
    If InStr(upperName, "EMC") > 0 Then
        GetFour = "EMC"
    Else
        GetFour = "SCC"
    End If
End Function

Function GetDateCompteurs(fileName As String, fournisseur As String) As String
    Dim parts() As String
    Dim result As String
    result = ""
    If fournisseur = "SCC" Then
        parts = Split(fileName, ".")
        If UBound(parts) >= 1 Then
            Dim datePart As String
            datePart = parts(1)
            If Len(datePart) >= 8 Then
                result = Left(datePart, 4) & "-" & Mid(datePart, 5, 2)
            End If
        End If
    ElseIf fournisseur = "EMC" Then
        parts = Split(fileName, "-")
        If UBound(parts) >= 7 Then
            result = parts(UBound(parts) - 2) & "-" & parts(UBound(parts) - 1)
        End If
    End If
    GetDateCompteurs = result
End Function

Function GetColumnIndex(ws As Worksheet, columnName As String) As Long
    Dim col As Long
    For col = 1 To ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
        If LCase(ws.Cells(1, col).Value) = LCase(columnName) Then
            GetColumnIndex = col
            Exit Function
        End If
    Next col
    GetColumnIndex = 0
End Function

Sub ImportCSV()
    Dim filePath As String
    Dim ws As Worksheet
    Dim fileNum As Integer
    Dim fileContent As String
    Dim lines() As String
    Dim i As Long, j As Long
    Dim headers() As String
    Dim data() As String
    Dim source As String, fournisseur As String, dateCompteurs As String
    Dim lastRow As Long
    Dim colSource As Long, colFour As Long, colDate As Long
    On Error GoTo ErrorHandler
    filePath = Application.GetOpenFilename("Fichiers CSV (*.csv), *.csv")
    If filePath = "False" Then Exit Sub
    fournisseur = GetFour(filePath)
    source = GetSourcePrefix(filePath)
    dateCompteurs = GetDateCompteurs(filePath, fournisseur)
    If dateCompteurs = "" Then
        MsgBox "Impossible de detecter la date dans le nom du fichier." & vbCrLf & _
               "Format attendu: ECOLE_KPAXManageReport.20251201... ou 78-exportkpaxemc-...-2026-08-03...", _
               vbExclamation
        Exit Sub
    End If
    fileNum = FreeFile()
    Open filePath For Input As #fileNum
    fileContent = Input$(LOF(fileNum), fileNum)
    Close #fileNum
    lines = Split(fileContent, vbCrLf)
    Set ws = ThisWorkbook.Sheets(SOURCE_SHEET)
    i = 0
    Do While i < UBound(lines) And Trim(lines(i)) = ""
        i = i + 1
    Loop
    If i > UBound(lines) Then
        MsgBox "Fichier vide ou format incorrect", vbExclamation
        Exit Sub
    End If
    headers = Split(lines(i), ",")
    For j = LBound(headers) To UBound(headers)
        ws.Cells(1, j + 1).Value = Trim(headers(j))
    Next j
    i = i + 1
    Dim row As Long
    row = 2
    Do While i <= UBound(lines)
        If Trim(lines(i)) <> "" Then
            data = Split(lines(i), ",")
            If UBound(data) >= UBound(headers) Then
                For j = LBound(headers) To UBound(headers)
                    ws.Cells(row, j + 1).Value = Trim(data(j))
                Next j
                row = row + 1
            End If
        End If
        i = i + 1
    Loop
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    colSource = GetColumnIndex(ws, "source")
    colFour = GetColumnIndex(ws, "fournisseur")
    colDate = GetColumnIndex(ws, "dateCompteurs")
    If colSource = 0 Then
        colSource = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column + 1
        ws.Cells(1, colSource).Value = "source"
    End If
    If colFour = 0 Then
        colFour = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column + 1
        ws.Cells(1, colFour).Value = "fournisseur"
    End If
    If colDate = 0 Then
        colDate = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column + 1
        ws.Cells(1, colDate).Value = "dateCompteurs"
    End If
    Dim r As Long
    For r = 2 To lastRow
        ws.Cells(r, colSource).Value = source
        ws.Cells(r, colFour).Value = fournisseur
        ws.Cells(r, colDate).Value = dateCompteurs
    Next r
    ThisWorkbook.RefreshAll
    MsgBox "Import termine!" & vbCrLf & vbCrLf & _
           "Lignes importees: " & (lastRow - 1), _
           vbInformation, "Import CSV"
    Exit Sub
ErrorHandler:
    MsgBox "Erreur: " & Err.Description, vbCritical, "Erreur d'import"
End Sub

Sub UpdateDashboard()
    Dim wsDashboard As Worksheet
    Dim lastRow As Long, r As Long
    On Error GoTo ErrorHandler
    Set wsDashboard = ThisWorkbook.Sheets(DASHBOARD_SHEET)
    Dim dernierMois As String
    dernierMois = "--"
    Dim wsSource As Worksheet
    Set wsSource = ThisWorkbook.Sheets(SOURCE_SHEET)
    Dim colDateCpt As Long
    colDateCpt = GetColumnIndex(wsSource, "dateCompteurs")
    If colDateCpt > 0 Then
        dernierMois = wsSource.Cells(wsSource.Rows.Count, colDateCpt).End(xlUp).Value
    End If
    If dernierMois <> "" Then
        Dim moisNum As Integer
        moisNum = Month(DateSerial(Val(Left(dernierMois, 4)), Val(Mid(dernierMois, 6, 2)), 1))
        Dim moisNom As String
        Select Case moisNum
            Case 1: moisNom = "janvier"
            Case 2: moisNom = "fevrier"
            Case 3: moisNom = "mars"
            Case 4: moisNom = "avril"
            Case 5: moisNom = "mai"
            Case 6: moisNom = "juin"
            Case 7: moisNom = "juillet"
            Case 8: moisNom = "aout"
            Case 9: moisNom = "septembre"
            Case 10: moisNom = "octobre"
            Case 11: moisNom = "novembre"
            Case 12: moisNom = "decembre"
        End Select
        wsDashboard.Range("B4").Value = moisNom & " " & Left(dernierMois, 4)
    End If
    Dim countEcoleImp As Long, countEcoleCop As Long
    Dim countEmsImp As Long, countEmsCop As Long
    Dim wsConso As Worksheet
    Set wsConso = ThisWorkbook.Sheets(CONSO_SHEET)
    lastRow = wsConso.Cells(wsConso.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lastRow
        If wsConso.Cells(r, 1).Value = "ECOLE" Then
            If InStr(wsConso.Cells(r, 4).Value, "Ricoh") > 0 Then
                countEcoleCop = countEcoleCop + 1
            Else
                countEcoleImp = countEcoleImp + 1
            End If
        ElseIf wsConso.Cells(r, 1).Value = "EMS" Then
            If InStr(wsConso.Cells(r, 4).Value, "Ricoh") > 0 Then
                countEmsCop = countEmsCop + 1
            Else
                countEmsImp = countEmsImp + 1
            End If
        End If
    Next r
    wsDashboard.Range("B5").Value = countEcoleImp
    wsDashboard.Range("D5").Value = countEcoleCop
    wsDashboard.Range("B6").Value = countEmsImp
    wsDashboard.Range("D6").Value = countEmsCop
    Dim totalEcoleMono As Long, totalEcoleCouleur As Long
    Dim totalEmsMono As Long, totalEmsCouleur As Long
    Dim wsStats As Worksheet
    Set wsStats = ThisWorkbook.Sheets(STATS_SHEET)
    lastRow = wsStats.Cells(wsStats.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lastRow
        If wsStats.Cells(r, 1).Value = "ECOLE" Then
            If IsNumeric(wsStats.Cells(r, 4).Value) Then
                totalEcoleMono = totalEcoleMono + wsStats.Cells(r, 4).Value
            End If
            If IsNumeric(wsStats.Cells(r, 5).Value) Then
                totalEcoleCouleur = totalEcoleCouleur + wsStats.Cells(r, 5).Value
            End If
        ElseIf wsStats.Cells(r, 1).Value = "EMS" Then
            If IsNumeric(wsStats.Cells(r, 4).Value) Then
                totalEmsMono = totalEmsMono + wsStats.Cells(r, 4).Value
            End If
            If IsNumeric(wsStats.Cells(r, 5).Value) Then
                totalEmsCouleur = totalEmsCouleur + wsStats.Cells(r, 5).Value
            End If
        End If
    Next r
    wsDashboard.Range("C9").Value = "Mono : " & Format(totalEcoleMono, "#,#")
    wsDashboard.Range("D9").Value = "Couleur : " & Format(totalEcoleCouleur, "#,#")
    wsDashboard.Range("C10").Value = "Mono : " & Format(totalEmsMono, "#,#")
    wsDashboard.Range("D10").Value = "Couleur : " & Format(totalEmsCouleur, "#,#")
    MsgBox "Tableau de bord mis a jour!", vbInformation, "Mise a jour"
    Exit Sub
ErrorHandler:
    MsgBox "Erreur: " & Err.Description, vbCritical, "Erreur de mise a jour"
End Sub

Sub CreateButtons()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Sheets(DASHBOARD_SHEET)
    Dim shp As Shape
    For Each shp In ws.Shapes
        If shp.Type = msoButton Then
            shp.Delete
        End If
    Next shp
    Dim btn As Button
    Set btn = ws.Buttons.Add(50, 100, 200, 30)
    With btn
        .Caption = "Importer CSV"
        .OnAction = "ImportCSV"
    End With
    Set btn = ws.Buttons.Add(50, 140, 200, 30)
    With btn
        .Caption = "Mettre a jour Dashboard"
        .OnAction = "UpdateDashboard"
    End With
    Set btn = ws.Buttons.Add(50, 180, 200, 30)
    With btn
        .Caption = "Rafraichir Tout"
        .OnAction = "RefreshAllData"
    End With
    MsgBox "Boutons crees!", vbInformation, "Creation des boutons"
End Sub

Sub RefreshAllData()
    On Error GoTo ErrorHandler
    ThisWorkbook.RefreshAll
    UpdateDashboard
    MsgBox "Donnees rafraichies et tableau de bord mis a jour!", vbInformation, "Rafraichissement"
    Exit Sub
ErrorHandler:
    MsgBox "Erreur: " & Err.Description, vbCritical, "Erreur de rafraichissement"
End Sub

Sub Auto_Open()
    CreateButtons
End Sub

Sub Initialize()
    CreateButtons
    MsgBox "Prototype ETL Kpax avec Power Query initialise!" & vbCrLf & vbCrLf & _
           "Pour commencer:" & vbCrLf & _
           "1. Creez les requetes Power Query" & vbCrLf & _
           "2. Utilisez les boutons du tableau de bord" & vbCrLf & _
           "3. Importez un fichier CSV" & vbCrLf & _
           "4. Rafraichissez les donnees", _
           vbInformation, "Initialisation"
End Sub
