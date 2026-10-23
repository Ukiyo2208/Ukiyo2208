package fr.ukiyo.beta

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.text.InputType
import android.widget.Switch
import android.widget.Toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class ReglagesActivity : Activity() {
    companion object {
        private const val IMPORT_MODELE = 2
    }

    private val scope = MainScope()
    private lateinit var reglages: Reglages

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        reglages = Reglages(this)

        val url = champ("http://192.168.1.20:8800", reglages.urlNas, InputType.TYPE_TEXT_VARIATION_URI)
        val jeton = champ("BETA_TOKEN du fichier .env", reglages.jeton, InputType.TYPE_TEXT_VARIATION_PASSWORD)
        val decimal = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
        val seuilWake = champ("0.5", reglages.seuilWakeWord.toString(), decimal)
        val seuilVisage = champ("0.4", reglages.seuilVisage.toString(), decimal)
        val rotation = champ(
            "auto",
            reglages.rotationCamera.takeIf { it >= 0 }?.toString() ?: "",
            InputType.TYPE_CLASS_NUMBER,
        )
        val piece = champ("salon", reglages.piece)
        val resultat = texte("", 16f, ACCENT)
        val modele = texte(etatModele(), 15f, TEXTE_DOUX)

        val kiosque = Switch(this).apply {
            text = "Mode kiosque : Bêta remplace l'écran d'accueil de la tablette"
            setTextColor(TEXTE)
            isChecked = packageManager.getComponentEnabledSetting(alias()) ==
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            setOnCheckedChangeListener { _, actif -> activerKiosque(actif) }
        }

        fun enregistrer() {
            reglages.urlNas = url.text.toString()
            reglages.jeton = jeton.text.toString()
            reglages.piece = piece.text.toString()
            seuilWake.text.toString().replace(',', '.').toFloatOrNull()?.let { reglages.seuilWakeWord = it }
            seuilVisage.text.toString().replace(',', '.').toFloatOrNull()?.let { reglages.seuilVisage = it }
            reglages.rotationCamera = rotation.text.toString().toIntOrNull() ?: -1
        }

        setContentView(
            defilable(
                colonne(
                    24,
                    titre("Réglages"),
                    texte("Adresse du NAS (service Bêta)", 15f, TEXTE_DOUX), url,
                    texte("Jeton", 15f, TEXTE_DOUX), jeton,
                    bouton("Tester la connexion") {
                        enregistrer()
                        resultat.text = "Test…"
                        scope.launch {
                            resultat.text = try {
                                withContext(Dispatchers.IO) { ClientNas(reglages).tester() }
                            } catch (e: Exception) {
                                "Échec : ${e.message}"
                            }
                        }
                    },
                    resultat,
                    texte("Pièce de la tablette (comme dans maison.zones du config.yaml)", 15f, TEXTE_DOUX), piece,
                    texte("Sensibilité « Hey Bêta » (0,3 = très sensible, 0,7 = strict)", 15f, TEXTE_DOUX), seuilWake,
                    texte("Seuil de reconnaissance du visage (0,4 conseillé)", 15f, TEXTE_DOUX), seuilVisage,
                    texte("Rotation caméra (vide = auto, sinon 0, 90, 180 ou 270)", 15f, TEXTE_DOUX), rotation,
                    texte("Modèle du mot d'activation", 15f, TEXTE_DOUX), modele,
                    ligne(
                        bouton("Importer hey_beta.onnx") { choisirModele() },
                        bouton("Modèle d'origine") {
                            Modeles.wakeWordPerso(this).delete()
                            modele.text = etatModele()
                        },
                    ),
                    kiosque,
                    bouton("Enregistrer") {
                        enregistrer()
                        // L'écran principal redémarre le service avec les nouveaux réglages
                        BetaService.arreter(this)
                        finish()
                    },
                ),
            ),
        )
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private fun etatModele() = if (Modeles.wakeWordPerso(this).exists()) {
        "Modèle personnalisé importé"
    } else {
        "Modèle d'origine (« Hey Jarvis », pour tester en attendant « Hey Bêta »)"
    }

    private fun choisirModele() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, IMPORT_MODELE)
    }

    @Deprecated("API Activity simple, sans AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data ?: return
        if (requestCode != IMPORT_MODELE || resultCode != RESULT_OK) return
        try {
            contentResolver.openInputStream(uri)!!.use { entree ->
                Modeles.wakeWordPerso(this).outputStream().use { entree.copyTo(it) }
            }
            Toast.makeText(this, "Modèle importé, appuie sur Enregistrer", Toast.LENGTH_LONG).show()
            recreate()
        } catch (e: Exception) {
            Toast.makeText(this, "Import impossible : ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun alias() = ComponentName(this, "$packageName.Accueil")

    private fun activerKiosque(actif: Boolean) {
        packageManager.setComponentEnabledSetting(
            alias(),
            if (actif) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP,
        )
        if (actif) {
            Toast.makeText(this, "Appuie sur le bouton Accueil et choisis Bêta « Toujours »", Toast.LENGTH_LONG).show()
        }
    }
}
