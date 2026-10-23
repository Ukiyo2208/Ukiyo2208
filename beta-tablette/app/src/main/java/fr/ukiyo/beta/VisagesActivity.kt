package fr.ukiyo.beta

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.SurfaceTexture
import android.os.Bundle
import android.os.SystemClock
import android.view.TextureView
import android.widget.LinearLayout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.opencv.android.OpenCVLoader

/** Enregistrer les visages des personnes de la maison (les empreintes restent sur la tablette). */
class VisagesActivity : Activity() {
    companion object {
        private const val NB_EMPREINTES = 8
        private const val INTERVALLE_MS = 300L
    }

    private val scope = MainScope()
    private lateinit var camera: CameraFrontale
    private var visages: Visages? = null
    private lateinit var etat: android.widget.TextView
    private lateinit var liste: LinearLayout
    private lateinit var apercu: TextureView

    @Volatile private var capture: MutableList<FloatArray>? = null
    @Volatile private var derniereCapture = 0L
    @Volatile private var visageVisible = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // La caméra ne peut servir qu'à un seul à la fois : on met le service en pause
        BetaService.arreter(this)
        camera = CameraFrontale({ rotationEcran(this) }, Reglages(this).rotationCamera)

        val nom = champ("Prénom (exactement comme dans config.yaml du NAS)")
        etat = texte("Chargement…", 16f, ACCENT)
        liste = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        apercu = TextureView(this)

        setContentView(
            defilable(
                colonne(
                    24,
                    titre("Visages"),
                    texte("Place-toi face à la tablette, bien éclairé, puis appuie sur Enregistrer. " +
                        "Refais-le avec et sans lunettes, ou à une autre heure, pour une meilleure reconnaissance.",
                        15f, TEXTE_DOUX),
                    apercu.also { it.layoutParams = LinearLayout.LayoutParams(dp(320), dp(240)) },
                    etat,
                    nom,
                    bouton("Enregistrer ce visage") { enregistrer(nom.text.toString().trim().lowercase()) },
                    texte("Personnes enregistrées", 20f, gras = true),
                    liste,
                    bouton("Envoyer les visages au NAS (caméras de la maison)") { envoyerAuNas() },
                ),
            ),
        )

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 1)
        }

        scope.launch {
            visages = withContext(Dispatchers.IO) {
                OpenCVLoader.initLocal()
                Modeles.visages(this@VisagesActivity)
            }
            etat.text = "Prêt"
            afficherListe()
            apercu.surfaceTextureListener = ecouteurApercu
            apercu.surfaceTexture?.let { demarrerCamera(it) }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        apercu.surfaceTexture?.let { demarrerCamera(it) }
    }

    override fun onDestroy() {
        scope.cancel()
        camera.arreter()
        BetaService.demarrer(this)
        super.onDestroy()
    }

    private val ecouteurApercu = object : TextureView.SurfaceTextureListener {
        override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) = demarrerCamera(surface)
        override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit
        override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
            camera.arreter()
            return true
        }
        override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
    }

    private fun demarrerCamera(surface: SurfaceTexture) {
        val v = visages ?: return
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return
        scope.launch(Dispatchers.IO) {
            val ok = camera.demarrer(surface) { image ->
                val empreinte = v.empreinte(image)
                visageVisible = empreinte != null
                val enCours = capture ?: return@demarrer
                val maintenant = SystemClock.elapsedRealtime()
                if (empreinte != null && maintenant - derniereCapture >= INTERVALLE_MS && enCours.size < NB_EMPREINTES) {
                    enCours.add(empreinte)
                    derniereCapture = maintenant
                }
            }
            if (!ok) withContext(Dispatchers.Main) { etat.text = "Caméra frontale introuvable" }
        }
    }

    private fun enregistrer(nom: String) {
        val v = visages ?: return
        if (nom.isEmpty()) {
            etat.text = "Indique d'abord un prénom"
            return
        }
        if (capture != null) return
        val enCours = java.util.Collections.synchronizedList(mutableListOf<FloatArray>())
        capture = enCours
        scope.launch {
            val debut = SystemClock.elapsedRealtime()
            while (enCours.size < NB_EMPREINTES && SystemClock.elapsedRealtime() - debut < 10_000) {
                etat.text = if (visageVisible) "Capture… ${enCours.size}/$NB_EMPREINTES" else "Je ne vois pas de visage"
                kotlinx.coroutines.delay(100)
            }
            capture = null
            if (enCours.size < 3) {
                etat.text = "Pas assez d'images du visage, réessaie face à la caméra"
                return@launch
            }
            withContext(Dispatchers.IO) { v.ajouter(nom, enCours.toList()) }
            etat.text = "Visage de $nom enregistré (${enCours.size} images)"
            afficherListe()
        }
    }

    private fun envoyerAuNas() {
        val v = visages ?: return
        etat.text = "Envoi…"
        scope.launch {
            etat.text = try {
                withContext(Dispatchers.IO) {
                    val client = ClientNas(Reglages(this@VisagesActivity))
                    v.noms.forEach { client.envoyerVisage(it, v.empreintes(it)) }
                }
                "Visages envoyés : ${v.noms.joinToString()}"
            } catch (e: Exception) {
                "Échec : ${e.message}"
            }
        }
    }

    private fun afficherListe() {
        val v = visages ?: return
        liste.removeAllViews()
        if (v.noms.isEmpty()) liste.addView(texte("Aucune pour l'instant", 16f, TEXTE_DOUX))
        for (nom in v.noms) {
            liste.addView(
                ligne(
                    texte("$nom (${v.nombreEmpreintes(nom)} images)"),
                    bouton("Supprimer") {
                        v.supprimer(nom)
                        afficherListe()
                    },
                ),
            )
        }
    }
}
