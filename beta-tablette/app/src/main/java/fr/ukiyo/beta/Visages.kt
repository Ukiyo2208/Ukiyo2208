package fr.ukiyo.beta

import org.json.JSONArray
import org.json.JSONObject
import org.opencv.core.Mat
import org.opencv.core.Size
import org.opencv.objdetect.FaceDetectorYN
import org.opencv.objdetect.FaceRecognizerSF
import java.io.File
import kotlin.math.sqrt

/**
 * Reconnaissance des visages : YuNet trouve le visage, SFace en calcule l'empreinte (128 valeurs).
 * Les empreintes des personnes enregistrées restent sur la tablette (visages.json) :
 * aucune image ne quitte l'appareil.
 */
class Visages(cheminYunet: String, cheminSface: String, private val fichier: File) {
    private val detecteur = FaceDetectorYN.create(cheminYunet, "", Size(320.0, 320.0), 0.8f, 0.3f, 5000)
    private val reconnaisseur = FaceRecognizerSF.create(cheminSface, "")
    private val personnes = mutableMapOf<String, MutableList<FloatArray>>()

    init {
        charger()
    }

    data class Identification(val nom: String?, val score: Float)

    val noms: List<String> @Synchronized get() = personnes.keys.sorted()

    @Synchronized
    fun nombreEmpreintes(nom: String) = personnes[nom]?.size ?: 0

    /** Empreinte du plus grand visage de l'image (BGR), ou null s'il n'y a personne. */
    @Synchronized
    fun empreinte(image: Mat): FloatArray? {
        detecteur.setInputSize(image.size())
        val visages = Mat()
        val aligne = Mat()
        val caracteristiques = Mat()
        try {
            detecteur.detect(image, visages)
            if (visages.rows() == 0) return null
            // Colonnes : x, y, largeur, hauteur, 5 points du visage, score
            val plusGrand = (0 until visages.rows()).maxBy { visages.get(it, 2)[0] * visages.get(it, 3)[0] }
            reconnaisseur.alignCrop(image, visages.row(plusGrand), aligne)
            reconnaisseur.feature(aligne, caracteristiques)
            return FloatArray(caracteristiques.cols()).also { caracteristiques.get(0, 0, it) }
        } finally {
            visages.release()
            aligne.release()
            caracteristiques.release()
        }
    }

    /** Compare l'empreinte à toutes les personnes enregistrées et retourne la plus proche. */
    @Synchronized
    fun identifier(empreinte: FloatArray): Identification {
        var meilleur = Identification(null, 0f)
        for ((nom, empreintes) in personnes) {
            for (e in empreintes) {
                val score = cosinus(empreinte, e)
                if (score > meilleur.score) meilleur = Identification(nom, score)
            }
        }
        return meilleur
    }

    @Synchronized
    fun ajouter(nom: String, empreintes: List<FloatArray>) {
        personnes.getOrPut(nom) { mutableListOf() }.addAll(empreintes)
        sauvegarder()
    }

    @Synchronized
    fun supprimer(nom: String) {
        personnes.remove(nom)
        sauvegarder()
    }

    private fun charger() {
        if (!fichier.exists()) return
        val json = JSONObject(fichier.readText())
        for (nom in json.keys()) {
            val liste = json.getJSONArray(nom)
            personnes[nom] = MutableList(liste.length()) { i ->
                val e = liste.getJSONArray(i)
                FloatArray(e.length()) { e.getDouble(it).toFloat() }
            }
        }
    }

    private fun sauvegarder() {
        val json = JSONObject()
        for ((nom, empreintes) in personnes) {
            json.put(nom, JSONArray(empreintes.map { e -> JSONArray(e.map { it.toDouble() }) }))
        }
        fichier.writeText(json.toString())
    }

    private fun cosinus(a: FloatArray, b: FloatArray): Float {
        var produit = 0f
        var na = 0f
        var nb = 0f
        for (i in a.indices) {
            produit += a[i] * b[i]
            na += a[i] * a[i]
            nb += b[i] * b[i]
        }
        return produit / (sqrt(na) * sqrt(nb) + 1e-9f)
    }
}
