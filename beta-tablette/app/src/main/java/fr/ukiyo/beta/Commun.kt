package fr.ukiyo.beta

import android.content.Context
import android.hardware.display.DisplayManager
import android.view.Display
import android.view.Surface
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import java.io.File

/** Ce que l'écran principal affiche, mis à jour par le service. */
object Etat {
    enum class Phase { ARRET, ECOUTE, COMMANDE, ENVOI, IDENTIFICATION, REPONSE, ERREUR }

    data class Affichage(
        val phase: Phase = Phase.ARRET,
        val message: String = "",
        val personne: String? = null,
        val texteReconnu: String = "",
        val reponse: String = "",
        val scoreWakeWord: Float = 0f,
    )

    private val _affichage = MutableStateFlow(Affichage())
    val affichage: StateFlow<Affichage> = _affichage

    /** Thread-safe : le micro, la caméra et le réseau mettent à jour l'affichage en parallèle. */
    fun maj(transformation: (Affichage) -> Affichage) = _affichage.update(transformation)
}

/** Accès aux modèles .onnx livrés dans l'APK (assets/modeles). */
object Modeles {
    const val MELSPEC = "melspectrogram.onnx"
    const val EMBEDDING = "embedding_model.onnx"
    const val WAKEWORD = "wakeword.onnx"
    const val YUNET = "face_detection_yunet_2023mar.onnx"
    const val SFACE = "face_recognition_sface_2021dec.onnx"

    /** Modèle « Hey Bêta » importé depuis les réglages ; remplace celui de l'APK. */
    fun wakeWordPerso(context: Context) = File(context.filesDir, "wakeword_perso.onnx")

    fun octets(context: Context, nom: String): ByteArray =
        context.assets.open("modeles/$nom").use { it.readBytes() }

    fun octetsWakeWord(context: Context): ByteArray =
        wakeWordPerso(context).takeIf { it.exists() }?.readBytes() ?: octets(context, WAKEWORD)

    /** OpenCV a besoin d'un vrai fichier : on copie le modèle une fois dans le stockage de l'app. */
    fun chemin(context: Context, nom: String): String {
        val fichier = File(context.filesDir, nom)
        if (!fichier.exists()) {
            context.assets.open("modeles/$nom").use { entree -> fichier.outputStream().use { entree.copyTo(it) } }
        }
        return fichier.absolutePath
    }

    fun visages(context: Context) = Visages(
        chemin(context, YUNET),
        chemin(context, SFACE),
        File(context.filesDir, "visages.json"),
    )
}

fun rotationEcran(context: Context): Int {
    val ecran = context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
    return when (ecran?.rotation) {
        Surface.ROTATION_90 -> 90
        Surface.ROTATION_180 -> 180
        Surface.ROTATION_270 -> 270
        else -> 0
    }
}
