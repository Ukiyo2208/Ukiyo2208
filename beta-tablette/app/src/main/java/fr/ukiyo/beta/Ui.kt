package fr.ukiyo.beta

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/** Petits outils pour construire les écrans en code (pas de fichiers XML). */

// Couleurs reprises du logo de Bêta
val FOND = Color.rgb(13, 17, 65)
val TEXTE = Color.rgb(236, 238, 255)
val TEXTE_DOUX = Color.rgb(160, 168, 215)
val ACCENT = Color.rgb(86, 200, 255)

fun Context.dp(valeur: Int) = (valeur * resources.displayMetrics.density).toInt()

fun Context.colonne(espacement: Int = 24, vararg vues: View) = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    setPadding(dp(espacement), dp(espacement), dp(espacement), dp(espacement))
    setBackgroundColor(FOND)
    vues.forEach { addView(it) }
}

fun Context.defilable(contenu: View) = ScrollView(this).apply {
    setBackgroundColor(FOND)
    addView(contenu)
}

fun Context.texte(valeur: String = "", taille: Float = 18f, couleur: Int = TEXTE, gras: Boolean = false) =
    TextView(this).apply {
        text = valeur
        textSize = taille
        setTextColor(couleur)
        if (gras) typeface = Typeface.DEFAULT_BOLD
        setPadding(0, dp(6), 0, dp(6))
    }

fun Context.titre(valeur: String) = texte(valeur, 26f, TEXTE, gras = true).apply { setPadding(0, 0, 0, dp(16)) }

fun Context.bouton(libelle: String, action: () -> Unit) = Button(this).apply {
    text = libelle
    isAllCaps = false
    setOnClickListener { action() }
}

fun Context.champ(indice: String, valeur: String = "", type: Int? = null) = EditText(this).apply {
    hint = indice
    setText(valeur)
    setTextColor(TEXTE)
    setHintTextColor(TEXTE_DOUX)
    type?.let { inputType = it }
    isSingleLine = true
}

fun Context.ligne(vararg vues: View) = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    vues.forEach { addView(it, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)) }
}
