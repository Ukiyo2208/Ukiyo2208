package fr.ukiyo.beta

import android.content.Context

/** Réglages modifiables depuis l'écran « Réglages ». */
class Reglages(context: Context) {
    private val prefs = context.getSharedPreferences("reglages", Context.MODE_PRIVATE)

    /** Adresse du service Bêta sur le NAS, ex : http://192.168.1.20:8800 */
    var urlNas: String
        get() = prefs.getString("url_nas", "")!!
        set(v) = prefs.edit().putString("url_nas", v.trim().trimEnd('/')).apply()

    /** Le BETA_TOKEN du fichier .env du NAS */
    var jeton: String
        get() = prefs.getString("jeton", "")!!
        set(v) = prefs.edit().putString("jeton", v.trim()).apply()

    /** Score à partir duquel « Hey Bêta » est considéré comme prononcé (0 à 1) */
    var seuilWakeWord: Float
        get() = prefs.getFloat("seuil_wake", 0.5f)
        set(v) = prefs.edit().putFloat("seuil_wake", v.coerceIn(0.05f, 0.99f)).apply()

    /** Similarité SFace minimale pour reconnaître quelqu'un (même personne ≈ 0,6 à 0,9, autre ≈ 0,2) */
    var seuilVisage: Float
        get() = prefs.getFloat("seuil_visage", 0.40f)
        set(v) = prefs.edit().putFloat("seuil_visage", v.coerceIn(0.2f, 0.95f)).apply()

    /** Rotation de l'image caméra en degrés, -1 = automatique (à changer si les visages ne sont jamais trouvés) */
    var rotationCamera: Int
        get() = prefs.getInt("rotation_camera", -1)
        set(v) = prefs.edit().putInt("rotation_camera", if (v in listOf(0, 90, 180, 270)) v else -1).apply()

    val estConfigure: Boolean get() = urlNas.isNotEmpty() && jeton.isNotEmpty()
}
