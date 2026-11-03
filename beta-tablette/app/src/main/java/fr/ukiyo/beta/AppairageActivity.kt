package fr.ukiyo.beta

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.SurfaceTexture
import android.net.Uri
import android.os.Bundle
import android.view.TextureView
import android.widget.LinearLayout
import android.widget.Toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.opencv.android.OpenCVLoader
import org.opencv.objdetect.QRCodeDetector

/**
 * Installation sans rien taper : on scanne le QR code affiché par l'installateur du NAS
 * (ou par le tableau de bord http://IP_DU_NAS:8800/tableau). Il contient l'adresse, le jeton et la pièce.
 */
class AppairageActivity : Activity() {
    companion object {
        const val PREFIXE = "beta://appairage"
    }

    private val scope = MainScope()
    private lateinit var camera: CameraFrontale
    private lateinit var apercu: TextureView
    private lateinit var etat: android.widget.TextView
    @Volatile private var termine = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BetaService.arreter(this) // la caméra ne sert qu'à un seul à la fois
        camera = CameraFrontale({ rotationEcran(this) }, Reglages(this).rotationCamera)
        apercu = TextureView(this)
        etat = texte("Montre le QR code à la caméra de la tablette", 18f, ACCENT)

        setContentView(
            defilable(
                colonne(
                    24,
                    titre("Connexion au NAS"),
                    texte(
                        "Sur le NAS, l'installateur affiche un QR code à la fin. Tu peux aussi l'afficher depuis " +
                            "un PC ou un téléphone : http://IP_DU_NAS:8800/tableau → « Afficher le QR d'appairage ».",
                        15f, TEXTE_DOUX,
                    ),
                    apercu.also { it.layoutParams = LinearLayout.LayoutParams(dp(320), dp(240)) },
                    etat,
                    bouton("Saisir l'adresse à la main") {
                        startActivity(Intent(this, ReglagesActivity::class.java))
                        finish()
                    },
                ),
            ),
        )

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 1)
        }
        scope.launch {
            withContext(Dispatchers.IO) { OpenCVLoader.initLocal() }
            apercu.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(s: SurfaceTexture, w: Int, h: Int) = demarrer(s)
                override fun onSurfaceTextureSizeChanged(s: SurfaceTexture, w: Int, h: Int) = Unit
                override fun onSurfaceTextureDestroyed(s: SurfaceTexture): Boolean {
                    camera.arreter()
                    return true
                }
                override fun onSurfaceTextureUpdated(s: SurfaceTexture) = Unit
            }
            apercu.surfaceTexture?.let { demarrer(it) }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        apercu.surfaceTexture?.let { demarrer(it) }
    }

    override fun onDestroy() {
        scope.cancel()
        camera.arreter()
        BetaService.demarrer(this)
        super.onDestroy()
    }

    private fun demarrer(surface: SurfaceTexture) {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return
        val detecteur = QRCodeDetector()
        scope.launch(Dispatchers.IO) {
            val ok = camera.demarrer(surface) { image ->
                if (termine) return@demarrer
                val contenu = detecteur.detectAndDecode(image)
                if (contenu.startsWith(PREFIXE)) {
                    termine = true
                    scope.launch { appliquer(contenu) }
                }
            }
            if (!ok) withContext(Dispatchers.Main) { etat.text = "Caméra introuvable : saisis l'adresse à la main" }
        }
    }

    private suspend fun appliquer(contenu: String) {
        val lien = Uri.parse(contenu)
        val url = lien.getQueryParameter("url").orEmpty()
        val jeton = lien.getQueryParameter("jeton").orEmpty()
        if (!url.startsWith("http") || jeton.isEmpty()) {
            etat.text = "QR code incomplet, réessaie"
            termine = false
            return
        }
        val reglages = Reglages(this)
        reglages.urlNas = url
        reglages.jeton = jeton
        lien.getQueryParameter("piece")?.takeIf { it.isNotBlank() }?.let { reglages.piece = it }
        etat.text = "Vérification…"
        val resultat = try {
            withContext(Dispatchers.IO) { ClientNas(reglages).tester() }
        } catch (e: Exception) {
            "Enregistré, mais le NAS ne répond pas : ${e.message}"
        }
        Toast.makeText(this, resultat, Toast.LENGTH_LONG).show()
        finish()
    }
}
